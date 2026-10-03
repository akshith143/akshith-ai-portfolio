// Turns sentences into audio as fast as possible.
//
// Clone mode: every sentence is POSTed to /api/tts the moment it's complete
// (so sentence N+1 synthesises while N is playing), and raw PCM is scheduled
// into Web Audio chunk-by-chunk as it streams in — playback starts on the
// first ~100 ms of audio rather than after a whole file downloads.
//
// Browser mode: falls back to speechSynthesis when no voice clone is set up.

export interface SpeakerEvents {
  onStart(): void; // first audio of a reply is audible
  onIdle(): void; // everything queued has finished playing
}

interface Segment {
  text: string;
  response: Promise<Response | null>;
}

const MIN_CHUNK_SAMPLES = 2400; // ~100 ms at 24 kHz — avoids clicks from tiny buffers

export class Speaker {
  readonly mode: "clone" | "browser";
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freq = new Uint8Array(0);
  private time = new Uint8Array(0);

  private queue: Segment[] = [];
  private draining = false;
  private generation = 0; // bumps on stop(); stale async work checks it and bails
  private aborts = new Set<AbortController>();
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private started = false;
  private previousText = "";
  private idleTimer = 0;
  private replyOpen = false; // more sentences may still arrive from the model

  // browser-voice state
  private synthVoice: SpeechSynthesisVoice | null = null;
  private synthSpeaking = false;

  constructor(mode: "clone" | "browser", private sampleRate: number, private events: SpeakerEvents) {
    this.mode = mode === "clone" ? "clone" : "browser";
    if (this.mode === "browser" && "speechSynthesis" in window) {
      const pick = () => (this.synthVoice = pickVoice(speechSynthesis.getVoices()));
      pick();
      speechSynthesis.addEventListener("voiceschanged", pick);
    }
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ sampleRate: this.sampleRate, latencyHint: "interactive" });
      } catch {
        // Some browsers refuse non-native rates; buffers still resample correctly.
        this.ctx = new AudioContext({ latencyHint: "interactive" });
      }
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.6;
      this.analyser.connect(this.ctx.destination);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.time = new Uint8Array(this.analyser.fftSize);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Call before streaming a reply's sentences in; idle can't fire until endReply(). */
  beginReply() {
    this.replyOpen = true;
    this.started = false;
  }

  /** No more sentences are coming for this reply. */
  endReply() {
    this.replyOpen = false;
    if (!this.busyExceptTimer()) this.scheduleIdle();
  }

  get busy() {
    return this.queue.length > 0 || this.draining || this.synthSpeaking || this.isPlaying();
  }

  speak(text: string) {
    text = text.trim();
    if (!text) return;
    clearTimeout(this.idleTimer);
    if (this.mode === "browser") return this.speakBrowser(text);

    const segment: Segment = { text, response: this.fetchAudio(text, this.previousText) };
    this.previousText = (this.previousText + " " + text).slice(-300);
    this.queue.push(segment);
    if (!this.draining) void this.drain();
  }

  /** Interrupt everything immediately (barge-in). */
  stop() {
    this.generation++;
    clearTimeout(this.idleTimer);
    for (const a of this.aborts) a.abort();
    this.aborts.clear();
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.sources.clear();
    this.queue = [];
    this.draining = false;
    this.replyOpen = false;
    this.started = false;
    this.previousText = "";
    this.nextTime = 0;
    if (this.mode === "browser" && "speechSynthesis" in window) speechSynthesis.cancel();
    this.synthSpeaking = false;
  }

  /** Mouth openness 0..1 for the avatar. */
  level(): number {
    if (this.mode === "browser") {
      if (!this.synthSpeaking) return 0;
      const t = performance.now() / 1000; // no audio graph for speechSynthesis — fake a plausible envelope
      return Math.max(0, 0.35 + 0.3 * Math.sin(t * 13) * Math.sin(t * 3.1) + 0.15 * Math.sin(t * 29));
    }
    if (!this.analyser || !this.isPlaying()) return 0;
    this.analyser.getByteTimeDomainData(this.time);
    let sum = 0;
    for (const v of this.time) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.time.length) * 4);
  }

  /** Frequency bins 0..255 for the ring visualiser (empty when silent). */
  frequencies(): Uint8Array {
    if (this.analyser && this.isPlaying()) this.analyser.getByteFrequencyData(this.freq);
    else this.freq.fill(0);
    return this.freq;
  }

  // ---------------------------------------------------------------------------

  private isPlaying() {
    return !!this.ctx && this.nextTime > this.ctx.currentTime;
  }

  private fetchAudio(text: string, previous: string): Promise<Response | null> {
    const ac = new AbortController();
    this.aborts.add(ac);
    return fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, previous }),
      signal: ac.signal,
    })
      .then((r) => (r.ok && r.body ? r : null))
      .catch(() => null)
      .finally(() => this.aborts.delete(ac));
  }

  private async drain() {
    this.draining = true;
    const gen = this.generation;
    while (this.queue.length && gen === this.generation) {
      const seg = this.queue.shift()!;
      const res = await seg.response;
      if (gen !== this.generation) return;
      if (!res) {
        // Voice service hiccup: say this sentence with the browser voice rather than skip it.
        this.speakBrowser(seg.text);
        continue;
      }
      await this.playStream(res, gen);
    }
    if (gen !== this.generation) return;
    this.draining = false;
    this.scheduleIdle();
  }

  private async playStream(res: Response, gen: number) {
    const ctx = this.ctx!;
    const reader = res.body!.getReader();
    let carry: Uint8Array | null = null; // odd trailing byte between network chunks
    let pending: Float32Array[] = [];
    let pendingLen = 0;

    const flush = () => {
      if (!pendingLen || gen !== this.generation) return;
      const buf = ctx.createBuffer(1, pendingLen, this.sampleRate);
      const ch = buf.getChannelData(0);
      let off = 0;
      for (const p of pending) { ch.set(p, off); off += p.length; }
      pending = [];
      pendingLen = 0;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.analyser!);
      const at = Math.max(this.nextTime, ctx.currentTime + 0.03);
      src.start(at);
      this.nextTime = at + buf.duration;
      this.sources.add(src);
      src.onended = () => this.sources.delete(src);
      if (!this.started) {
        this.started = true;
        this.events.onStart();
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (gen !== this.generation) { void reader.cancel(); return; }
        if (done) break;
        let bytes = value;
        if (carry) {
          const merged = new Uint8Array(carry.length + bytes.length);
          merged.set(carry);
          merged.set(bytes, carry.length);
          bytes = merged;
          carry = null;
        }
        if (bytes.length % 2) {
          carry = bytes.slice(-1);
          bytes = bytes.subarray(0, bytes.length - 1);
        }
        const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
        const f = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) f[i] = samples[i] / 32768;
        pending.push(f);
        pendingLen += f.length;
        if (pendingLen >= MIN_CHUNK_SAMPLES) flush();
      }
      flush();
    } catch {
      /* aborted mid-stream */
    }
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    const remaining = this.ctx ? Math.max(0, this.nextTime - this.ctx.currentTime) : 0;
    const gen = this.generation;
    this.idleTimer = window.setTimeout(() => {
      if (gen !== this.generation || this.replyOpen || this.busyExceptTimer()) return;
      this.started = false;
      this.previousText = "";
      this.events.onIdle();
    }, remaining * 1000 + 60);
  }

  private busyExceptTimer() {
    return this.queue.length > 0 || this.draining || this.synthSpeaking || this.isPlaying();
  }

  private speakBrowser(text: string) {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.synthVoice) u.voice = this.synthVoice;
    u.rate = 1.04;
    const gen = this.generation;
    u.onstart = () => {
      if (gen !== this.generation) return;
      this.synthSpeaking = true;
      if (!this.started) { this.started = true; this.events.onStart(); }
    };
    u.onend = u.onerror = () => {
      if (gen !== this.generation) return;
      if (!speechSynthesis.pending && !speechSynthesis.speaking) {
        this.synthSpeaking = false;
        if (!this.draining) this.scheduleIdle();
      }
    };
    speechSynthesis.speak(u);
  }
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const prefer = [/rishi/i, /en-IN/i, /google uk english male/i, /daniel/i, /male/i, /aaron|alex|fred/i];
  for (const re of prefer) {
    const v = en.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) return v;
  }
  return en[0] ?? null;
}

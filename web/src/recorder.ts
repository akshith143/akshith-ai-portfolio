import type { ListenerEvents } from "./listener";

// Fallback voice input: record the question with MediaRecorder, detect the end
// of speech with a simple energy-based VAD, then transcribe on the server.

const MIN_SPEECH_RMS = 0.01; // floor for the adaptive speech threshold
const MAX_NOISE_RMS = 0.015; // cap on the measured room noise, so speaking during calibration can't deafen us
const LIKELY_VOICE_RMS = 0.02; // if we never got sure but heard this much, let the server decide
const CALIBRATE_MS = 350; // measure room noise this long before listening for speech
const SILENT_MIC_RMS = 0.0015; // a live mic is never this quiet — the OS is feeding us zeros
const END_SILENCE_MS = 900; // pause that ends the turn
const NO_SPEECH_MS = 7000; // give up if nobody talks
const MAX_MS = 20000;

export class RecorderListener {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private raf = 0;
  private active = false;
  private discard = false;

  static supported() {
    return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  constructor(private events: ListenerEvents) {}

  get listening() {
    return this.active;
  }

  async start() {
    if (this.active) return;
    this.active = true;
    this.discard = false;
    // Create/resume the audio graph *before* the first await, while we're still
    // inside the click: browsers keep a context started later suspended, and a
    // suspended analyser reads pure silence.
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    try {
      // Keep the mic open between turns so hands-free mode doesn't re-prompt.
      this.stream ??= await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.active = false;
      this.events.onError("not-allowed");
      return;
    }
    if (!this.active) return; // cancelled while the permission prompt was up

    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    const src = this.ctx.createMediaStreamSource(this.stream);
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const chunks: Blob[] = [];
    const rec = new MediaRecorder(this.stream);
    this.recorder = rec;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const began = performance.now();
    let spoke = false;
    let lastVoice = began;
    let noise = Infinity; // quietest level seen while calibrating ≈ the room's background
    let peak = 0;

    rec.onstop = async () => {
      cancelAnimationFrame(this.raf);
      src.disconnect();
      this.recorder = null;
      if (this.discard) return;
      // Never confidently detected speech, but something voice-loud happened:
      // send it anyway rather than telling the visitor we heard nothing.
      if (!spoke && peak >= LIKELY_VOICE_RMS) spoke = true;
      if (!spoke) {
        this.active = false;
        // Pure digital silence means the OS (or another app) is withholding the mic.
        if (peak < SILENT_MIC_RMS) this.events.onError("silent-mic");
        else this.events.onError("no-speech");
        return;
      }
      this.events.onInterim("Transcribing…");
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const r = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        const { text, error } = (await r.json()) as { text?: string; error?: string };
        if (this.discard) return;
        this.active = false;
        if (!r.ok) return this.events.onError(error || "stt-failed");
        if (text) this.events.onFinal(text);
        this.events.onEnd(Boolean(text));
      } catch {
        if (this.discard) return;
        this.active = false;
        this.events.onError("network");
      }
    };

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      peak = Math.max(peak, rms);
      this.events.onLevel?.(rms);
      if (now - began < CALIBRATE_MS) {
        noise = Math.min(noise, rms);
        this.raf = requestAnimationFrame(tick);
        return;
      }
      // Speech = clearly above the room's noise floor, whatever the mic's gain.
      if (rms > Math.max(MIN_SPEECH_RMS, Math.min(noise, MAX_NOISE_RMS) * 3)) {
        if (!spoke) this.events.onInterim("Listening…");
        spoke = true;
        lastVoice = now;
      }
      const done =
        (spoke && now - lastVoice > END_SILENCE_MS) || (!spoke && now - began > NO_SPEECH_MS) || now - began > MAX_MS;
      if (done) {
        if (rec.state !== "inactive") rec.stop();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };

    rec.start();
    this.raf = requestAnimationFrame(tick);
  }

  cancel() {
    if (!this.active) return;
    this.discard = true;
    this.active = false;
    cancelAnimationFrame(this.raf);
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
  }
}

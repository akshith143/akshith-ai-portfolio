// Thin wrapper over the Web Speech API (Chrome, Edge, Safari). Recognition
// runs in the browser, so there is no upload round-trip before we can reply.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export interface ListenerEvents {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onEnd(heardSomething: boolean): void;
  onError(error: string): void;
}

export class NativeListener {
  private rec: Recognition | null = null;
  private active = false;
  private heard = false;

  static supported() {
    const w = window as unknown as Record<string, unknown>;
    // Brave exposes the API but ships without Google's speech service, so it
    // always fails with a "network" error. Skip straight to the fallback.
    if ("brave" in navigator) return false;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  constructor(private events: ListenerEvents) {
    const w = window as unknown as Record<string, new () => Recognition>;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = false; // end on the first pause — that's the turn boundary
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) this.events.onInterim(interim);
      if (final.trim()) {
        this.heard = true;
        this.events.onFinal(final.trim());
      }
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") this.events.onError(e.error);
    };
    rec.onend = () => {
      const was = this.active;
      this.active = false;
      if (was) this.events.onEnd(this.heard);
    };
    this.rec = rec;
  }

  get listening() {
    return this.active;
  }

  start() {
    if (!this.rec || this.active) return;
    this.heard = false;
    this.active = true;
    try {
      this.rec.start();
    } catch {
      this.active = false; // already started by the browser — ignore
    }
  }

  /** Stop and discard; no onEnd callback. */
  cancel() {
    if (!this.rec || !this.active) return;
    this.active = false;
    this.rec.abort();
  }
}

// Errors that mean the browser's recognition service itself is unusable here,
// as opposed to the visitor denying the mic or just not speaking.
const SERVICE_ERRORS = new Set(["network", "service-not-allowed", "language-not-supported"]);

/**
 * Picks the best available voice input: in-browser recognition where it works
 * (Chrome, Edge, Safari — fastest, shows words as you talk), otherwise record
 * and transcribe on the server. Switches over automatically if the native
 * service turns out to be broken at runtime.
 */
export class Listener {
  private native: NativeListener | null = null;
  private recorder: import("./recorder").RecorderListener | null = null;

  static async create(events: ListenerEvents, serverStt: boolean): Promise<Listener | null> {
    const { RecorderListener } = await import("./recorder");
    const canRecord = serverStt && RecorderListener.supported();
    if (!NativeListener.supported() && !canRecord) return null;
    const l = new Listener();
    if (canRecord) l.recorder = new RecorderListener(events);
    if (NativeListener.supported()) {
      l.native = new NativeListener({
        ...events,
        onError: (e) => {
          if (SERVICE_ERRORS.has(e) && l.recorder) {
            console.warn(`Browser speech recognition unavailable (${e}); using server transcription.`);
            l.native = null;
            void l.recorder.start();
          } else {
            events.onError(e);
          }
        },
        onEnd: (heard) => {
          if (l.native) events.onEnd(heard); // suppressed once we've switched to the recorder
        },
      });
    }
    return l;
  }

  get listening() {
    return this.native ? this.native.listening : !!this.recorder?.listening;
  }

  start() {
    if (this.native) this.native.start();
    else void this.recorder?.start();
  }

  cancel() {
    this.native?.cancel();
    this.recorder?.cancel();
  }
}

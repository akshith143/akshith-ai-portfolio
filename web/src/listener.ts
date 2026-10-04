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

  /** The API exists in this browser (it may still not work — see prefersNativeSpeech). */
  static supported() {
    const w = window as unknown as Record<string, unknown>;
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

/**
 * Whether this browser's built-in recognition actually works. Chromium's
 * SpeechRecognition streams audio to Google's servers, which only Google Chrome
 * and Microsoft Edge are allowed to use; every other Chromium browser (Brave,
 * Opera, Comet, Vivaldi, Arc, Samsung Internet…) exposes the API but never
 * hears anything. Safari uses Apple's on-device engine and works. Anything
 * not on this allowlist records and transcribes on the server instead.
 */
export function prefersNativeSpeech(
  brands: readonly { brand: string }[] | undefined,
  userAgent: string,
  isBrave: boolean,
): boolean {
  if (isBrave) return false;
  if (brands && brands.length) return brands.some((b) => /^(Google Chrome|Microsoft Edge)$/.test(b.brand));
  // No Client Hints: Safari (and every iOS browser, which are all WebKit) or Firefox.
  const iOS = /iPhone|iPad|iPod/.test(userAgent);
  const desktopSafari = /Safari\//.test(userAgent) && !/Chrome|Chromium|Edg|OPR|Firefox|SamsungBrowser/.test(userAgent);
  return iOS || desktopSafari;
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
  private startedAt = 0;

  static async create(events: ListenerEvents, serverStt: boolean): Promise<Listener | null> {
    const { RecorderListener } = await import("./recorder");
    const canRecord = serverStt && RecorderListener.supported();
    const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } };
    const trusted = prefersNativeSpeech(nav.userAgentData?.brands, navigator.userAgent, "brave" in navigator);
    // Use the built-in engine only where it really works — or as a last resort
    // when the server can't transcribe.
    const useNative = NativeListener.supported() && (trusted || !canRecord);
    if (!useNative && !canRecord) return null;
    const l = new Listener();
    if (canRecord) l.recorder = new RecorderListener(events);
    if (useNative) {
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
          if (!l.native) return; // already switched to the recorder
          // A working engine waits several seconds for speech. Ending almost
          // immediately with nothing heard means it's a dud in this browser.
          if (!heard && l.recorder && performance.now() - l.startedAt < 1500) {
            console.warn("Browser speech recognition ended instantly; using server transcription.");
            l.native = null;
            void l.recorder.start();
            return;
          }
          events.onEnd(heard);
        },
      });
    }
    return l;
  }

  get listening() {
    return this.native ? this.native.listening : !!this.recorder?.listening;
  }

  start() {
    this.startedAt = performance.now();
    if (this.native) this.native.start();
    else void this.recorder?.start();
  }

  cancel() {
    this.native?.cancel();
    this.recorder?.cancel();
  }
}

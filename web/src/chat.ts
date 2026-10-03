export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** Streams a reply from /api/chat, calling onDelta with each text fragment. */
export async function streamReply(
  history: Turn[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!frame.startsWith("data: ")) continue;
      const evt = JSON.parse(frame.slice(6)) as { t: string; text?: string; message?: string };
      if (evt.t === "delta" && evt.text) onDelta(evt.text);
      else if (evt.t === "error") throw new Error(evt.message || "Something went wrong.");
    }
  }
}

// Words that end in "." without ending a sentence.
const ABBREV = /(?:\b[A-Z]|\bMr|\bMs|\bDr|\bSt|\bvs|\betc|\be\.g|\bi\.e|M\.Sc|B\.Tech)\.$/;

/**
 * Splits streaming text into speakable pieces. Sentence boundaries normally,
 * but the very first piece may break early at a comma so the voice starts
 * while the model is still writing the rest of the sentence.
 */
export class SentenceChunker {
  private buf = "";
  private emitted = 0;

  constructor(private emit: (sentence: string) => void) {}

  push(text: string) {
    this.buf += text;
    for (;;) {
      const cut = this.findCut();
      if (cut < 0) return;
      const piece = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut);
      if (piece) {
        this.emitted++;
        this.emit(piece);
      }
    }
  }

  flush() {
    const piece = this.buf.trim();
    this.buf = "";
    if (piece) this.emit(piece);
  }

  private findCut(): number {
    const re = /[.!?]+["')\]]?(?=\s)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[0].length;
      if (end < 12) continue; // "Sure." on its own sounds clipped; merge with the next
      if (ABBREV.test(this.buf.slice(0, end))) continue;
      return end;
    }
    if (this.emitted === 0 && this.buf.length > 70) {
      const comma = this.buf.slice(40).search(/[,;:—–](?=\s)/);
      if (comma >= 0) return 40 + comma + 1;
    }
    // Runaway sentence with no punctuation: cut at a space so audio keeps flowing.
    if (this.buf.length > 260) {
      const sp = this.buf.lastIndexOf(" ", 220);
      if (sp > 0) return sp;
    }
    return -1;
  }
}

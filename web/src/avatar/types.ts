export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

export interface AudioTap {
  level(): number; // 0..1 loudness of the AI voice right now
  frequencies(): Uint8Array; // 0..255 per bin
}

export interface Avatar {
  setState(state: AvatarState): void;
  dispose(): void;
}

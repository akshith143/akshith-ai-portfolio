import type { Request, Response } from "express";

// Server-side speech-to-text for browsers whose built-in recognition doesn't
// work (Brave, Firefox). The browser records a short clip and posts it here;
// we forward it to ElevenLabs Speech-to-Text so the key stays server-side.

const MAX_BYTES = 4 * 1024 * 1024; // ~4 min of opus; questions are seconds long

export const sttConfigured = () => Boolean(process.env.ELEVENLABS_API_KEY);

export async function sttHandler(req: Request, res: Response) {
  if (!sttConfigured()) return res.status(503).json({ error: "Speech-to-text not configured." });

  const audio = req.body as Buffer;
  if (!Buffer.isBuffer(audio) || audio.length === 0 || audio.length > MAX_BYTES) {
    return res.status(400).json({ error: "Invalid audio." });
  }
  const type = (req.headers["content-type"] || "audio/webm").split(";")[0];
  const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";

  const form = new FormData();
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([new Uint8Array(audio)], { type }), `question.${ext}`);

  const upstreamAbort = new AbortController();
  res.on("close", () => upstreamAbort.abort());

  try {
    const upstream = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      body: form,
      signal: upstreamAbort.signal,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error(`[stt] ElevenLabs ${upstream.status}: ${detail.slice(0, 300)}`);
      return res.status(502).json({ error: "Speech-to-text unavailable." });
    }
    const data = (await upstream.json()) as { text?: string };
    res.json({ text: (data.text ?? "").trim() });
  } catch (err) {
    if (upstreamAbort.signal.aborted) return;
    console.error("[stt] request failed:", (err as Error).message);
    if (!res.headersSent) res.status(502).json({ error: "Speech-to-text unavailable." });
  }
}

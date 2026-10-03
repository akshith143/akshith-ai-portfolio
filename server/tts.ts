import type { Request, Response } from "express";

// Proxies ElevenLabs streaming TTS so the API key never reaches the browser.
// Raw 16-bit PCM is streamed straight through, which lets the client start
// playback on the first chunk instead of waiting for a whole MP3 to decode.

export const SAMPLE_RATE = 24_000;
const MAX_TEXT = 600;

// Fixed lines (the greeting) are synthesised once and replayed from memory:
// instant for visitors and no per-visit voice credits. Only context-free
// requests are cached, since `previous` changes the intonation.
const CACHE_MAX = 32;
const CACHE_MAX_BYTES = 2 * 1024 * 1024;
const cache = new Map<string, Buffer>();

export const voiceConfigured = () =>
  Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);

function synthesize(text: string, previous: string | undefined, signal: AbortSignal) {
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID!)}/stream?output_format=pcm_${SAMPLE_RATE}`,
    {
      method: "POST",
      signal,
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
        Accept: "audio/pcm",
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
        // previous_text keeps intonation continuous across sentence-sized chunks.
        ...(previous ? { previous_text: previous } : {}),
        voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
      }),
    },
  );
}

function remember(text: string, audio: Buffer) {
  if (audio.length === 0 || audio.length > CACHE_MAX_BYTES) return;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(text, audio);
}

/** Synthesise a fixed line at startup so the first visitor doesn't pay the voice's cold start. */
export async function prewarm(text: string) {
  if (!voiceConfigured() || cache.has(text)) return;
  try {
    const res = await synthesize(text, undefined, AbortSignal.timeout(20_000));
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    remember(text, Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    console.warn("[tts] prewarm failed:", (err as Error).message);
  }
}

export async function ttsHandler(req: Request, res: Response) {
  if (!voiceConfigured()) return res.status(503).json({ error: "Voice clone not configured." });

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const previous = typeof req.body?.previous === "string" && req.body.previous.trim() ? req.body.previous.slice(-300) : undefined;
  if (!text || text.length > MAX_TEXT) return res.status(400).json({ error: "Invalid text." });

  const headers = { "Content-Type": "audio/pcm", "X-Sample-Rate": String(SAMPLE_RATE), "Cache-Control": "no-store" };
  const cached = !previous && cache.get(text);
  if (cached) {
    res.writeHead(200, headers);
    return res.end(cached);
  }

  const upstreamAbort = new AbortController();
  res.on("close", () => upstreamAbort.abort());

  try {
    const upstream = await synthesize(text, previous, upstreamAbort.signal);
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error(`[tts] ElevenLabs ${upstream.status}: ${detail.slice(0, 300)}`);
      return res.status(502).json({ error: "Voice service unavailable." });
    }

    res.writeHead(200, headers);
    const chunks: Buffer[] = [];
    for await (const chunk of upstream.body) {
      const buf = Buffer.from(chunk);
      if (!previous) chunks.push(buf);
      res.write(buf);
    }
    res.end();
    if (!previous) remember(text, Buffer.concat(chunks));
  } catch (err) {
    if (upstreamAbort.signal.aborted) return;
    console.error("[tts] request failed:", (err as Error).message);
    if (!res.headersSent) res.status(502).json({ error: "Voice service unavailable." });
    else res.end();
  }
}

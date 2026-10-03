import Anthropic from "@anthropic-ai/sdk";
import type { Request, Response } from "express";

const client = new Anthropic({ maxRetries: 1, timeout: 30_000 });

const MODEL = process.env.PORTFOLIO_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.PORTFOLIO_EFFORT || "low") as Anthropic.Beta.BetaOutputConfig["effort"];

const MAX_TURNS = 12;
const MAX_CHARS = 1500;

let systemPrompt = "";
export const setSystemPrompt = (text: string) => {
  systemPrompt = text;
};

export const aiConfigured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

function parseHistory(body: unknown): Anthropic.Beta.BetaMessageParam[] | null {
  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const msgs = raw.slice(-MAX_TURNS).map((m) => ({
    role: (m as { role?: unknown })?.role,
    content: (m as { content?: unknown })?.content,
  }));
  // Slicing can leave an assistant turn first; the API requires a user turn.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();

  for (let i = 0; i < msgs.length; i++) {
    const { role, content } = msgs[i];
    const expected = i % 2 === 0 ? "user" : "assistant";
    if (role !== expected || typeof content !== "string" || !content.trim() || content.length > MAX_CHARS) {
      return null;
    }
  }
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== "user") return null;
  return msgs as Anthropic.Beta.BetaMessageParam[];
}

const FALLBACK_LINE =
  "Sorry, I couldn't answer that one. Try asking me about my experience, my projects, or how I approach backend performance.";

// POST /api/chat — Server-Sent Events: {t:"delta",text} … {t:"done"} | {t:"error",message}
export async function chatHandler(req: Request, res: Response) {
  const messages = parseHistory(req.body);
  if (!messages) return res.status(400).json({ error: "Invalid conversation payload." });
  if (!aiConfigured()) return res.status(503).json({ error: "The AI isn't configured on this server yet." });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // stop nginx-style proxies from buffering the stream
  });
  res.flushHeaders();
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: EFFORT },
    // Safety declines are re-served by Anthropic's recommended fallback model
    // instead of leaving a recruiter with silence.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages,
  });

  // Visitor hung up or barged in — stop paying for tokens nobody will hear.
  res.on("close", () => stream.abort());

  let sentText = false;
  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        sentText = true;
        send({ t: "delta", text: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal" && !sentText) send({ t: "delta", text: FALLBACK_LINE });
    send({ t: "done" });
  } catch (err) {
    if (stream.aborted) return;
    if (err instanceof Anthropic.RateLimitError) {
      send({ t: "error", message: "I'm getting a lot of questions right now — try again in a few seconds." });
    } else if (err instanceof Anthropic.AuthenticationError) {
      console.error("[chat] Anthropic authentication failed — check ANTHROPIC_API_KEY");
      send({ t: "error", message: "The AI isn't configured correctly on this server." });
    } else if (err instanceof Anthropic.APIError) {
      console.error(`[chat] Anthropic API error ${err.status}:`, err.message);
      send({ t: "error", message: "Something went wrong on my side. Please try again." });
    } else {
      console.error("[chat] unexpected error:", err);
      send({ t: "error", message: "Something went wrong on my side. Please try again." });
    }
  } finally {
    res.end();
  }
}

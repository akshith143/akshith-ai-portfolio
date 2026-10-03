import type { RequestHandler } from "express";

// Fixed-window in-memory limiter. Good enough for a single-instance portfolio;
// swap for Redis if you ever run more than one instance.
export function rateLimit(perMinute: number): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, 60_000).unref();

  return (req, res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    if (++entry.count > perMinute) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: "Too many requests — give me a moment and try again." });
    }
    next();
  };
}

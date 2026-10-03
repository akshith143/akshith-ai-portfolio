import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { aiConfigured, chatHandler, setSystemPrompt } from "./chat.js";
import { getRepos, startRepoRefresh } from "./github.js";
import { profile } from "./profile.js";
import { buildSystemPrompt } from "./prompt.js";
import { rateLimit } from "./rateLimit.js";
import { sttConfigured, sttHandler } from "./stt.js";
import { prewarm, SAMPLE_RATE, ttsHandler, voiceConfigured } from "./tts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Compiled (dist/server/index.js) → serve the built site from dist/web.
// Under tsx in dev, Vite serves the front end and we only read web/public.
const isBuilt = import.meta.url.endsWith(".js");
const webDir = isBuilt ? path.resolve(here, "../web") : path.resolve(here, "../web/public");

const PORT = Number(process.env.PORT) || 8787;
const PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 20;

setSystemPrompt(buildSystemPrompt(getRepos()));
void prewarm(profile.greeting);
const githubReady = startRepoRefresh(() => setSystemPrompt(buildSystemPrompt(getRepos())));

function avatarConfig() {
  if (fs.existsSync(path.join(webDir, "avatar/avatar.glb"))) return { type: "glb", url: "/avatar/avatar.glb" };
  for (const ext of ["webp", "jpg", "jpeg", "png"]) {
    if (fs.existsSync(path.join(webDir, `avatar/photo.${ext}`))) return { type: "photo", url: `/avatar/photo.${ext}` };
  }
  return { type: "photo", url: "https://avatars.githubusercontent.com/u/15259032?v=4&s=480" };
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
// Never compress /api — gzip buffers SSE and streamed audio, which kills latency.
app.use(compression({ filter: (req, res) => !req.path.startsWith("/api") && compression.filter(req, res) }));
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.json({
    name: profile.name,
    shortName: profile.shortName,
    headline: profile.headline,
    greeting: profile.greeting,
    location: profile.location,
    contact: profile.contact,
    ai: aiConfigured(),
    voice: voiceConfigured() ? "clone" : "browser",
    stt: sttConfigured(),
    sampleRate: SAMPLE_RATE,
    avatar: avatarConfig(),
    experience: profile.experience.map(({ company, role, period, highlights }) => ({ company, role, period, highlights })),
    projects: profile.projects.map((p) => ({
      name: p.name,
      kind: p.kind,
      summary: p.summary,
      stack: p.stack,
      // Only link a write-up once the file has actually been added.
      file: "file" in p && fs.existsSync(path.join(webDir, p.file)) ? `/${p.file}` : undefined,
    })),
    certifications: profile.certifications.map((c) => ({ ...c, image: `/${c.image}` })),
    languages: profile.languages,
    hobbies: profile.hobbies,
    education: profile.education,
    fellowships: profile.fellowships,
    skills: profile.skills,
  });
});

app.post("/api/chat", rateLimit(PER_MIN), chatHandler);
app.post("/api/tts", rateLimit(PER_MIN * 4), ttsHandler);
app.post("/api/stt", rateLimit(PER_MIN), express.raw({ type: "audio/*", limit: "4mb" }), sttHandler);

if (isBuilt) {
  app.use("/assets", express.static(path.join(webDir, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(webDir, { maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDir, "index.html")));
}

const server = app.listen(PORT, async () => {
  await githubReady;
  console.log(`AI portfolio API on http://localhost:${PORT}`);
  console.log(`  model: ${process.env.PORTFOLIO_MODEL || "claude-opus-5-5"} · AI ${aiConfigured() ? "on" : "OFF (set ANTHROPIC_API_KEY)"} · voice: ${voiceConfigured() ? "cloned (ElevenLabs)" : "browser fallback"} · repos: ${getRepos().length}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

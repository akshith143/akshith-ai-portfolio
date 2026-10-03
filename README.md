# Akshith — AI portfolio

A voice-first portfolio. Recruiters talk to an AI twin of me; it answers from my resume and projects, **in my cloned voice**, through an avatar that lip-syncs as it speaks.

```
 mic ──► Web Speech API (in-browser STT, no upload)
           │ final transcript
           ▼
 POST /api/chat ──► Claude (streamed over SSE)
           │ text deltas
           ▼
 SentenceChunker ── first clause / each sentence ──► POST /api/tts ──► ElevenLabs Flash (PCM stream)
                                                          │
 avatar ◄── AnalyserNode ◄── Web Audio (plays first ~100 ms chunk immediately)
```

## Quick start

```bash
cp .env.example .env     # add ANTHROPIC_API_KEY (and ElevenLabs keys for the voice clone)
npm install
npm run dev              # http://localhost:5173
```

Production:

```bash
npm run build && npm start          # http://localhost:8787
# or
docker build -t ai-portfolio . && docker run -p 8787:8787 --env-file .env ai-portfolio
```

Without any keys the site still loads; the AI shows as offline. Without the ElevenLabs keys it speaks with a browser voice.

## Making it *you*

| Step | What to do |
|---|---|
| **Voice** | Record 1–3 min of yourself answering interview questions → put the files in `voice-samples/` → set `ELEVENLABS_API_KEY` → `npm run clone-voice` → paste the printed `ELEVENLABS_VOICE_ID` into `.env`. See [voice-samples/README.md](voice-samples/README.md). |
| **Face / 3D model** | Drop `avatar.glb` (3D, lip-synced) or `photo.jpg` into `web/public/avatar/`. Defaults to the GitHub avatar. See [web/public/avatar/README.md](web/public/avatar/README.md). |
| **Knowledge** | Everything the twin can say is in [server/profile.ts](server/profile.ts). Edit it and restart. Public GitHub repos are pulled in automatically every 6 hours. |
| **Personality / rules** | [server/prompt.ts](server/prompt.ts): spoken style, length, honesty rules, what to deflect (salary, notice period → "email me"). |
| **Resume download** | `web/public/resume.pdf`. |

## Why it's fast

Time-to-first-word is what makes a voice agent feel alive. Each stage overlaps the next:

- **STT in the browser.** The Web Speech API transcribes locally/streaming, so the question is ready the moment you stop talking.
- **Streaming LLM.** Claude's reply streams token-by-token over SSE (compression is disabled on `/api` so nothing buffers it). The system prompt is byte-stable and prompt-cached (1 h TTL).
- **Speak before the answer is finished.** The chunker sends the first clause to TTS as soon as it reaches a comma, then each sentence as it completes. Sentence *N+1* synthesises while *N* plays.
- **Streamed PCM, not MP3.** The TTS proxy forwards raw 24 kHz PCM; the browser schedules ~100 ms buffers into Web Audio as they arrive instead of waiting for a file to download and decode.
- **Low-latency models.** ElevenLabs `eleven_flash_v2_5`; Claude effort defaults to `low` for conversational replies.
- **Tiny page.** ~12 KB gzipped of JS+CSS, system fonts, no framework. three.js (~150 KB gz) only loads if you add a 3D model.
- **Barge-in.** Tapping the mic while the twin is talking cancels the LLM stream, in-flight TTS requests and queued audio instantly.

To trade a little quality for more speed, set `PORTFOLIO_MODEL=claude-sonnet-5-5` or `claude-haiku-4-5` in `.env`.

## Configuration

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for the AI to answer |
| `PORTFOLIO_MODEL` | `claude-opus-5-5` | Any Claude model id |
| `PORTFOLIO_EFFORT` | `low` | `low` / `medium` / `high` — higher is slower |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | — | Your cloned voice; falls back to browser speech |
| `ELEVENLABS_MODEL` | `eleven_flash_v2_5` | |
| `RATE_LIMIT_PER_MIN` | `20` | Per-IP chat requests/min (TTS gets 4×) — protects your API bill |
| `GITHUB_TOKEN` | — | Optional; avoids GitHub's unauthenticated rate limit |
| `PORT` | `8787` | |

## Safety & cost guards

- API keys stay server-side; the browser only talks to `/api/*`.
- Per-IP rate limits, 32 KB body cap, history capped at 12 turns × 1,500 chars, TTS text capped at 600 chars.
- Disconnects abort the upstream Claude and ElevenLabs requests, so you don't pay for audio nobody hears.
- The prompt keeps the twin first-person but honest: it never invents facts, says it's an AI when sincerely asked, deflects salary/notice-period questions to email, and ignores attempts to override its instructions.
- Server-side refusal fallback (`fallbacks: "default"`) is enabled so a rare safety decline is re-served rather than leaving the visitor in silence.
- The footer discloses that the voice is an AI clone.

## Browser support

Voice input uses the browser's built-in recognition in Chrome, Edge and Safari (fastest — words appear as you talk). Brave and Firefox don't have a working speech service, so there the site records the question and transcribes it server-side with ElevenLabs Speech-to-Text (`/api/stt`, same `ELEVENLABS_API_KEY`). It also switches to that path automatically if the native service errors out. Without an ElevenLabs key, those browsers can still type. Space bar toggles the mic on desktop.

## Deploying

**Render (free):** New → Blueprint → select this repo. [render.yaml](render.yaml) fills in the build/start commands, Node 22 and the health check; Render then asks for `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. The free tier sleeps after ~15 min idle, so point a free uptime monitor (UptimeRobot, cron-job.org) at `/api/health` every 10 minutes to keep the first visit instant. Set a monthly spend limit in the Claude Console and ElevenLabs before sharing the link.

**Anywhere else:**

Any Node host that supports streaming responses works (Render, Railway, Fly.io, a VM, Cloud Run). Make sure your proxy/CDN does **not** buffer `text/event-stream` or `audio/pcm` responses. For the lowest latency, host in a region near your audience and near ElevenLabs/Anthropic (US-East or EU-West).

import "./styles.css";
import { SentenceChunker, streamReply, type Turn } from "./chat";
import { Listener } from "./listener";
import { Speaker } from "./speaker";
import { createPhotoAvatar } from "./avatar/photo";
import type { Avatar, AvatarState } from "./avatar/types";

interface Config {
  name: string;
  shortName: string;
  greeting: string;
  ai: boolean;
  voice: "clone" | "browser";
  stt: boolean;
  sampleRate: number;
  avatar: { type: "glb" | "photo"; url: string };
  contact: { email: string; github: string; linkedin: string };
  experience: { company: string; role: string; period: string; highlights: string[] }[];
  projects: { name: string; kind: string; summary: string; stack: string[]; file?: string }[];
  certifications: { title: string; issuer: string; detail: string; image: string }[];
  languages: string[];
  hobbies: string[];
  education: { degree: string; school: string; period: string }[];
  fellowships: { title: string; org: string; period: string; detail: string }[];
  skills: Record<string, string[]>;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  avatar: $("avatar"),
  ring: $<HTMLCanvasElement>("ring"),
  photo: $<HTMLImageElement>("photo"),
  status: $("status"),
  statusText: $("status-text"),
  captionUser: $("caption-user"),
  captionAi: $("caption-ai"),
  start: $<HTMLButtonElement>("start"),
  console: $("console"),
  form: $<HTMLFormElement>("ask-form"),
  input: $<HTMLInputElement>("ask-input"),
  mic: $<HTMLButtonElement>("mic"),
  chips: $("chips"),
  voiceNote: $("voice-note"),
  drawer: $("drawer"),
  scrim: $("scrim"),
  transcript: $("transcript"),
};

const IDLE_HINT = "Tap the mic and ask me anything";

const history: Turn[] = [];
let config: Config;
let speaker: Speaker;
let listener: Listener | null = null;
let avatar: Avatar;
let conversing = false; // hands-free loop: listen → answer → listen again
let inflight: AbortController | null = null;
let replyId = 0;

// ---------------------------------------------------------------------------
// UI state

function setState(state: AvatarState | "error", text?: string) {
  el.status.className = `status ${state}`;
  el.statusText.textContent =
    text ?? { idle: IDLE_HINT, listening: "Listening…", thinking: "Thinking…", speaking: "Speaking", error: "Something went wrong" }[state];
  avatar?.setState(state === "error" ? "idle" : state);
}

function setConversing(on: boolean) {
  conversing = on;
  el.mic.setAttribute("aria-pressed", String(on));
  el.mic.setAttribute("aria-label", on ? "Stop conversation" : "Start talking");
}

function addTranscript(role: "user" | "assistant", text: string) {
  el.transcript.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  li.className = role;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = role === "user" ? "You" : `${config.shortName} (AI)`;
  li.append(who, document.createTextNode(text));
  el.transcript.append(li);
}

// ---------------------------------------------------------------------------
// Conversation

function interrupt() {
  replyId++;
  inflight?.abort();
  inflight = null;
  speaker.stop();
}

async function ask(question: string) {
  question = question.trim();
  if (!question) return;
  interrupt();
  listener?.cancel();
  speaker.unlock();

  const id = replyId;
  history.push({ role: "user", content: question });
  addTranscript("user", question);
  el.captionUser.textContent = `“${question}”`;
  el.captionAi.textContent = "";
  el.captionAi.classList.remove("error");

  if (!config.ai) {
    showError("The AI isn't connected on this server yet — please check back soon, or reach me by email.");
    history.pop();
    return;
  }

  setState("thinking");
  const ac = new AbortController();
  inflight = ac;
  let answer = "";
  const chunker = new SentenceChunker((s) => speaker.speak(s));
  speaker.beginReply();

  try {
    await streamReply(
      history.slice(),
      (delta) => {
        if (id !== replyId) return;
        answer += delta;
        el.captionAi.textContent = answer;
        el.captionAi.scrollTop = el.captionAi.scrollHeight;
        chunker.push(delta);
      },
      ac.signal,
    );
    if (id !== replyId) return;
    chunker.flush();
    speaker.endReply();
    inflight = null;
    if (answer.trim()) {
      history.push({ role: "assistant", content: answer.trim() });
      addTranscript("assistant", answer.trim());
    } else {
      history.pop();
    }
  } catch (err) {
    if (id !== replyId || ac.signal.aborted) return;
    history.pop(); // keep history alternating user/assistant
    speaker.stop();
    showError((err as Error).message);
  }
}

function showError(message: string) {
  el.captionAi.textContent = message;
  el.captionAi.classList.add("error");
  setConversing(false);
  setState("error", "Tap the mic to try again");
}

function listen() {
  if (!listener) return;
  interrupt();
  speaker.unlock();
  el.captionUser.textContent = "";
  setState("listening");
  listener.start();
}

function onSpeakerIdle() {
  if (conversing && listener) listen();
  else setState("idle");
}

// ---------------------------------------------------------------------------
// Boot

async function loadConfig(): Promise<Config> {
  try {
    const r = await fetch("/api/config");
    if (r.ok) return (await r.json()) as Config;
  } catch {
    /* fall through */
  }
  return {
    name: "Satya Akshith Pakalapati", shortName: "Akshith", ai: false,
    greeting: "Hi, I'm Akshith's AI twin. Ask me anything about my experience.", voice: "browser", stt: false, sampleRate: 24000,
    avatar: { type: "photo", url: "https://avatars.githubusercontent.com/u/15259032?v=4&s=480" },
    contact: { email: "akshith.pakalapati@gmail.com", github: "https://github.com/akshith143", linkedin: "https://linkedin.com/in/akshith-pakalapati-993646108" },
    experience: [], projects: [], education: [], fellowships: [], certifications: [], languages: [], hobbies: [], skills: {},
  };
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function askButton(label: string, question: string) {
  const b = h("button", "ask-ai", `${label} →`);
  b.type = "button";
  b.dataset.ask = question;
  return b;
}

function renderSections() {
  const tl = $("timeline");
  config.experience.forEach((e, i) => {
    const li = h("li", `job reveal${i === 0 ? " current" : ""}`);
    const top = h("div", "job-top");
    const title = h("h3", undefined, e.role);
    title.append(h("span", undefined, ` · ${e.company}`));
    const period = h("span", "period", e.period);
    if (/present/i.test(e.period)) period.append(h("span", "now", "Now"));
    top.append(title, period);
    const ul = h("ul");
    for (const x of e.highlights.slice(0, 3)) ul.append(h("li", undefined, x));
    // "FPL Technologies (OneCard)" → "OneCard"; "Cargo Exchange India Private Limited" → "Cargo Exchange".
    const company = e.company.match(/\(([^)]+)\)/)?.[1] ?? e.company.replace(/ India Private Limited$/, "");
    li.append(top, ul, askButton(`Ask my AI about ${company}`, `Tell me about your work at ${e.company}.`));
    tl.append(li);
  });

  const grid = $("project-grid");
  for (const p of config.projects) {
    const card = h("article", "project reveal");
    const stack = h("div", "stack");
    for (const s of p.stack) stack.append(h("span", undefined, s));
    card.append(
      h("span", "tag", p.kind.replace(/\s*\(.*\)/, "")),
      h("h3", undefined, p.name),
      h("p", undefined, p.summary),
      stack,
      askButton("Ask my AI about it", `Tell me about ${p.name}. What did you find?`),
    );
    if (p.file) {
      const link = h("a", "doc-link", "Read the case study (PDF) ↗");
      link.href = p.file;
      link.target = "_blank";
      link.rel = "noopener";
      card.append(link);
    }
    // Spotlight follows the cursor across the card.
    card.addEventListener("pointermove", (ev) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      card.style.setProperty("--my", `${ev.clientY - r.top}px`);
    });
    grid.append(card);
  }

  const ach = $("achievement-grid");
  for (const f of config.fellowships) {
    const card = h("article", "award reveal");
    const body = h("div");
    const org = h("div", "org", f.org);
    body.append(h("span", "tag", `Fellowship · ${f.period}`), h("h3", undefined, f.title), org, h("p", undefined, f.detail),
      askButton("Ask my AI about the fellowship", `Tell me about your University Innovation Fellowship with Stanford's d.school. What did you take away from it?`));
    card.append(h("div", "medal", "🏅"), body);
    ach.append(card);
  }
  for (const c of config.certifications) {
    const card = h("article", "cert reveal");
    const img = document.createElement("img");
    img.src = c.image;
    img.alt = `${c.title} certificate`;
    img.loading = "lazy";
    img.decoding = "async";
    const thumb = h("a", "cert-img");
    thumb.href = c.image;
    thumb.target = "_blank";
    thumb.rel = "noopener";
    thumb.append(img);
    const body = h("div");
    body.append(h("span", "tag", "Certification"), h("h3", undefined, c.title), h("p", "org", c.issuer), h("p", undefined, c.detail),
      askButton("Ask my AI about my SQL work", "What have you done with SQL? Tell me about your SQL certification and case study."));
    card.append(thumb, body);
    ach.append(card);
  }
  const edu = $("education-grid");
  for (const e of config.education) {
    const current = /expected/i.test(e.period);
    const card = h("div", `edu reveal${current ? " current" : ""}`);
    card.append(
      h("span", "tag", current ? `${e.period} · In progress` : e.period),
      h("h3", undefined, e.degree),
      h("p", undefined, e.school),
    );
    if (current) card.append(askButton("Ask my AI about the M.Sc.", "Why are you doing an M.Sc. in AI and ML, and what are you learning?"));
    edu.append(card);
  }

  const langs = $("language-list");
  for (const l of config.languages) langs.append(h("span", "lang", l));
  const hobbyIcons: [RegExp, string][] = [[/badminton/i, "🏸"], [/anime|series|watch/i, "🎬"], [/read/i, "📚"]];
  const hobbies = $("hobby-list");
  for (const hobby of config.hobbies) {
    const li = h("li");
    li.append(h("span", "hobby-icon", hobbyIcons.find(([re]) => re.test(hobby))?.[1] ?? "✨"), h("span", undefined, hobby));
    hobbies.append(li);
  }
  hobbies.parentElement!.append(askButton("Ask my AI what I do for fun", "What do you do outside work? Any anime or series you'd recommend?"));

  const sk = $("skills-grid");
  for (const [group, items] of Object.entries(config.skills)) {
    const card = h("div", "skill-card reveal");
    const stack = h("div", "stack");
    for (const s of items) stack.append(h("span", undefined, s));
    card.append(h("h3", undefined, group), stack);
    sk.append(card);
  }
}

function revealOnScroll() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) return items.forEach((n) => n.classList.add("in"));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  items.forEach((n) => io.observe(n));
}

/** On phones the avatar is pinned at the top; bring the mic up just under it. */
function revealConsoleOnMobile() {
  if (!window.matchMedia("(max-width: 960px)").matches) return;
  requestAnimationFrame(() => el.console.scrollIntoView({ block: "end", behavior: reduceMotion ? "auto" : "smooth" }));
}

// ---------------------------------------------------------------------------
// Loading screen

const SPLASH_MAX_MS = 7000; // never hold visitors longer than this; the poster covers the rest
let splashGone = false;

function splashStep(text: string, fraction?: number) {
  if (splashGone) return;
  $("splash-step").textContent = text;
  if (fraction !== undefined) $("splash-bar").style.width = `${Math.round(8 + fraction * 92)}%`;
}

/** Fade the loading screen out and start the landing animations behind it. */
function hideSplash() {
  if (splashGone) return;
  splashGone = true;
  $("splash-bar").style.width = "100%";
  $("splash").classList.add("done");
  document.documentElement.classList.remove("loading");
  setTimeout(() => $("splash").remove(), 600);
}

// ---------------------------------------------------------------------------
// Landing-page motion

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Types and deletes phrases after "a software engineer who ships …". */
function runRotator() {
  const node = document.getElementById("rotator-text");
  if (!node || reduceMotion) return;
  const phrases = ["scalable APIs", "fintech platforms", "full stack products", "AI-powered features"];
  let i = 0;
  let text = phrases[0];
  let deleting = false;
  const tick = () => {
    const target = phrases[i];
    if (!deleting) {
      if (text === target) {
        deleting = true;
        return setTimeout(tick, 2200); // hold the full phrase
      }
      text = target.slice(0, text.length + 1);
    } else {
      if (text === "") {
        deleting = false;
        i = (i + 1) % phrases.length;
        return setTimeout(tick, 250);
      }
      text = text.slice(0, -1);
    }
    node.textContent = text;
    setTimeout(tick, deleting ? 35 : 70);
  };
  setTimeout(tick, 2600);
}

/** Stats count up (or down, for latency) once they're on screen. */
function runCounters() {
  const items = document.querySelectorAll<HTMLElement>(".count");
  if (reduceMotion) return;
  for (const el of items) el.textContent = el.dataset.from ?? "0";
  setTimeout(() => {
    const start = performance.now();
    const dur = 1600;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      for (const el of items) {
        const from = Number(el.dataset.from ?? 0);
        const to = Number(el.dataset.to);
        el.textContent = String(Math.round(from + (to - from) * ease));
      }
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, 650);
}

/** The avatar stage leans gently toward the pointer. */
function tiltStage() {
  const wrap = document.querySelector<HTMLElement>(".stage-wrap");
  const hero = document.querySelector<HTMLElement>(".hero");
  if (!wrap || !hero || reduceMotion || !window.matchMedia("(pointer: fine)").matches) return;
  hero.addEventListener("pointermove", (e) => {
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
    const y = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
    wrap.style.setProperty("--ry", `${(x * 8).toFixed(2)}deg`);
    wrap.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
  });
  hero.addEventListener("pointerleave", () => {
    wrap.style.setProperty("--ry", "0deg");
    wrap.style.setProperty("--rx", "0deg");
  });
}

function usePhotoAvatar() {
  el.photo.src = config.avatar.type === "photo" ? config.avatar.url : "https://avatars.githubusercontent.com/u/15259032?v=4&s=480";
  avatar = createPhotoAvatar(el.avatar, el.photo, el.ring, speaker);
}

async function mountAvatar() {
  // With a 3D model, a still of that same model (poster.webp, already loading
  // from the HTML) holds its place until the live model fades in on top.
  const poster = document.getElementById("poster");
  if (config.avatar.type === "glb" && poster) {
    el.avatar.classList.add("has-poster");
    avatar = { setState: (s) => void (el.avatar.dataset.state = s), dispose() {} };
  } else {
    poster?.remove();
    usePhotoAvatar();
  }
  if (config.avatar.type !== "glb") return;
  try {
    // three.js is only downloaded when there's a 3D model to show.
    const { createModelAvatar } = await import("./avatar/model3d");
    el.avatar.addEventListener("avatar-ready", () => {
      splashStep("Ready", 1);
      setTimeout(hideSplash, 150);
    }, { once: true });
    const model = await createModelAvatar(el.avatar, config.avatar.url, speaker, (f) =>
      splashStep(`Loading my 3D twin… ${Math.round(f * 100)}%`, 0.15 + f * 0.8),
    );
    avatar.dispose();
    avatar = model;
  } catch (err) {
    console.warn("3D avatar failed to load:", err);
    hideSplash();
    if (!document.getElementById("poster")) usePhotoAvatar(); // the poster stays if we have one
  }
}

function wireDrawer() {
  const open = (v: boolean) => {
    el.drawer.classList.toggle("open", v);
    el.drawer.setAttribute("aria-hidden", String(!v));
    $("drawer-open").setAttribute("aria-expanded", String(v));
    el.scrim.hidden = !v;
  };
  $("drawer-open").addEventListener("click", () => open(true));
  $("drawer-close").addEventListener("click", () => open(false));
  el.scrim.addEventListener("click", () => open(false));
  document.addEventListener("keydown", (e) => e.key === "Escape" && open(false));
}

async function boot() {
  config = await loadConfig();
  speaker = new Speaker(config.voice, config.sampleRate, {
    onStart: () => setState("speaking"),
    onIdle: onSpeakerIdle,
  });
  splashStep("Loading my profile…", 0.12);
  setTimeout(hideSplash, SPLASH_MAX_MS - performance.now());
  void mountAvatar();
  if (config.avatar.type !== "glb") hideSplash(); // nothing heavy to wait for
  renderSections();
  revealOnScroll();
  runRotator();
  runCounters();
  tiltStage();
  wireDrawer();

  el.voiceNote.textContent = config.voice === "clone" ? "" : "(Voice clone not configured — using a browser voice.)";
  if (!config.ai) el.voiceNote.textContent = "AI offline on this server.";

  listener = await Listener.create(
    {
      onInterim: (t) => (el.captionUser.textContent = t),
      // Status dot pulses with the mic level, so visitors can see they're being heard.
      onLevel: (rms) => el.status.style.setProperty("--mic", String(Math.min(1, rms * 10))),
      onFinal: (t) => void ask(t),
      onEnd: (heard) => {
        if (!heard) {
          setConversing(false);
          setState("idle");
        }
      },
      onError: (e) => {
        setConversing(false);
        const messages: Record<string, string> = {
          "not-allowed": "Microphone blocked — click the icon at the left of the address bar and allow Microphone.",
          "service-not-allowed": "Microphone blocked — click the icon at the left of the address bar and allow Microphone.",
          "silent-mic":
            "Your browser is getting silence from the mic. On a Mac: System Settings → Privacy & Security → Microphone → turn on your browser, then restart it.",
          "no-speech": "I didn't hear anything — tap the mic and speak a little louder or closer.",
        };
        const help = messages[e];
        if (help) {
          el.captionAi.textContent = help;
          el.captionAi.classList.add("error");
        }
        setState("error", e === "no-speech" ? "Didn't hear you — tap the mic to retry" : "Microphone problem — see the message");
      },
    },
    config.stt,
  );
  if (!listener) {
    el.mic.disabled = true;
    el.mic.title = "Voice input isn't available in this browser — try Chrome, Edge or Safari, or type your question";
    el.input.placeholder = "Type your question…";
  }

  setState("idle", "Ready when you are");

  el.start.addEventListener("click", () => {
    speaker.unlock();
    el.start.hidden = true;
    el.console.hidden = false;
    revealConsoleOnMobile();
    const greeting = config.greeting;
    el.captionAi.textContent = greeting;
    // The greeting is canned so it plays instantly — no model round-trip.
    speaker.beginReply();
    speaker.speak(greeting);
    speaker.endReply();
    if (listener) setConversing(true);
  });

  el.mic.addEventListener("click", () => {
    if (conversing || listener?.listening) {
      setConversing(false);
      listener?.cancel();
      interrupt();
      setState("idle");
    } else {
      setConversing(true);
      listen(); // also barges in if I'm mid-sentence
    }
  });

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = el.input.value;
    el.input.value = "";
    setConversing(false);
    void ask(q);
  });

  el.chips.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn) return;
    el.start.hidden = true;
    el.console.hidden = false;
    void ask(btn.textContent ?? "");
  });

  // "Ask my AI about …" buttons on experience and project cards: jump back to
  // the avatar and ask the question out loud.
  document.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ask]");
    if (!btn) return;
    el.start.hidden = true;
    el.console.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    void ask(btn.dataset.ask ?? "");
  });

  // Copy-to-clipboard for the email and phone in the contact section.
  document.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
    if (!btn) return;
    void navigator.clipboard?.writeText(btn.dataset.copy ?? "").then(() => {
      btn.textContent = "Copied ✓";
      btn.classList.add("done");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("done");
      }, 1600);
    });
  });

  // Space bar = push to talk (when not typing).
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || document.activeElement === el.input || el.console.hidden) return;
    e.preventDefault();
    el.mic.click();
  });
}

void boot();

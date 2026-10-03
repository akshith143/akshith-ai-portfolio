import type { AudioTap, Avatar, AvatarState } from "./types";

const COLORS: Record<AvatarState, string> = {
  idle: "148, 160, 180",
  listening: "245, 158, 11",
  thinking: "167, 139, 250",
  speaking: "20, 184, 166",
};
const BARS = 96;

// Portrait avatar: the photo "breathes" with the voice and a radial
// visualiser around it shows who is talking. Pure canvas, no dependencies.
export function createPhotoAvatar(root: HTMLElement, photo: HTMLImageElement, canvas: HTMLCanvasElement, audio: AudioTap): Avatar {
  const g = canvas.getContext("2d")!;
  let state: AvatarState = "idle";
  let raf = 0;
  let smooth = new Float32Array(BARS);
  let talk = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = now / 1000;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const photoR = (photo.clientWidth * (w / canvas.clientWidth)) / 2 || w * 0.34;
    const base = photoR + w * 0.025;
    const color = COLORS[state];
    g.clearRect(0, 0, w, h);

    // Target bar heights per state.
    const freq = audio.frequencies();
    const level = audio.level();
    for (let i = 0; i < BARS; i++) {
      let target = 0;
      const mirrored = i < BARS / 2 ? i : BARS - 1 - i; // symmetric: low freqs at the top
      if (state === "speaking") {
        const bin = Math.floor((mirrored / (BARS / 2)) * freq.length * 0.7);
        target = (freq[bin] ?? 0) / 255;
        if (!freq.length || target === 0) target = level * (0.5 + 0.5 * Math.sin(i * 0.9 + t * 9)); // browser-voice mode
      } else if (state === "listening") {
        target = 0.18 + 0.14 * Math.sin(t * 5 + i * 0.35) * Math.sin(t * 2.3 + i * 0.11);
      } else if (state === "thinking") {
        const head = (t * 1.4) % 1;
        const d = Math.abs(((i / BARS - head + 1.5) % 1) - 0.5);
        target = Math.max(0, 0.32 - d * 1.6);
      } else {
        target = 0.04 + 0.03 * Math.sin(t * 1.2 + i * 0.2);
      }
      smooth[i] += (target - smooth[i]) * (target > smooth[i] ? 0.45 : 0.15);
    }

    const maxLen = w * 0.12;
    const barW = Math.max(2, ((2 * Math.PI * base) / BARS) * 0.42);
    g.lineCap = "round";
    g.lineWidth = barW;
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
      const len = 2 + smooth[i] * maxLen;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      g.strokeStyle = `rgba(${color}, ${0.25 + smooth[i] * 0.75})`;
      g.beginPath();
      g.moveTo(cx + cos * base, cy + sin * base);
      g.lineTo(cx + cos * (base + len), cy + sin * (base + len));
      g.stroke();
    }

    // Soft glow behind the portrait.
    const glow = g.createRadialGradient(cx, cy, photoR * 0.9, cx, cy, photoR * 1.35);
    const glowAlpha = state === "idle" ? 0.05 + 0.03 * Math.sin(t * 1.2) : 0.12 + level * 0.25;
    glow.addColorStop(0, `rgba(${color}, ${glowAlpha})`);
    glow.addColorStop(1, `rgba(${color}, 0)`);
    g.fillStyle = glow;
    g.beginPath();
    g.arc(cx, cy, photoR * 1.35, 0, Math.PI * 2);
    g.fill();

    // The portrait itself breathes, and pulses with the voice.
    talk += (level - talk) * 0.35;
    const breathe = 1 + 0.006 * Math.sin(t * 1.6);
    photo.style.setProperty("--talk", String(breathe + talk * 0.035));
  };
  raf = requestAnimationFrame(frame);

  return {
    setState(s) {
      state = s;
      root.dataset.state = s;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      g.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

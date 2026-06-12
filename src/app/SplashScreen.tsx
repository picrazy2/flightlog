import { useEffect, useState, type CSSProperties } from "react";

// Intro splash shown while flights load: a backgroundless Journia "J" assembles in
// the centre while a flurry of translucent J's tumbles down the screen behind it.

const COLORS = ["#5B9DFF", "#2DD4BF", "#7DB4FF", "#9BC2FF"];

// Decorrelated hash so each attribute varies independently (avoids the visible
// "waves" you get when one seed drives everything). Deterministic → stable renders.
const hash = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x); // 0..1
};

// A dense, varied spread of falling J's. Each starts at a random phase of its OWN
// fall (delay in [-dur, 0]) so at any instant they're scattered top-to-bottom — a
// continuous drizzle rather than synchronized bands.
const FALLERS = Array.from({ length: 36 }, (_, i) => {
  const dur = 5 + hash(i, 3) * 9; // 5–14s: a wide spread of speeds
  return {
    left: hash(i, 1) * 100,
    size: 12 + hash(i, 2) * 46, // 12–58px
    dur,
    delay: -hash(i, 4) * dur,
    rot: (hash(i, 5) < 0.5 ? -1 : 1) * (160 + hash(i, 6) * 360),
    op: 0.06 + hash(i, 7) * 0.2,
    color: COLORS[Math.floor(hash(i, 8) * COLORS.length)],
  };
});

// The bare "J" hook (no background, no globe) — used both as falling confetti and,
// at large size with the plane + origin node, as the centre mark.
const J_PATH = "M43 16 L43 36 C43 44 36.5 48 27.5 45.6";

function Faller({ f }: { f: (typeof FALLERS)[number] }) {
  const style = {
    position: "absolute",
    left: `${f.left}%`,
    top: 0,
    "--j-rot": `${f.rot}deg`,
    "--j-op": f.op,
    animation: `j-fall ${f.dur}s linear ${f.delay}s infinite`,
  } as CSSProperties;
  return (
    <svg viewBox="0 0 64 64" width={f.size} height={f.size} fill="none" aria-hidden style={style}>
      <path d={J_PATH} stroke={f.color} strokeWidth="6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function CentreMark({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <defs>
        <linearGradient id="sp-arc" x1="43" y1="12" x2="27" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5B9DFF" />
          <stop offset="1" stopColor="#2DD4BF" />
        </linearGradient>
        <radialGradient id="sp-amber" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFC061" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFC061" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d={J_PATH}
        stroke="url(#sp-arc)"
        strokeWidth="5.5"
        strokeLinecap="round"
        fill="none"
        style={{ strokeDasharray: 64, animation: "draw 760ms cubic-bezier(.16,1,.3,1) 120ms both" }}
      />
      <circle cx="27.5" cy="45.6" r="8" fill="url(#sp-amber)" style={{ transformOrigin: "27.5px 45.6px", animation: "pop 500ms cubic-bezier(.16,1,.3,1) 760ms both" }} />
      <circle cx="27.5" cy="45.6" r="3.6" fill="#FFC061" stroke="#0A0E15" strokeWidth="1.4" style={{ transformOrigin: "27.5px 45.6px", animation: "pop 500ms cubic-bezier(.16,1,.3,1) 760ms both" }} />
      <g transform="translate(43 12) rotate(10)" fill="#EAF2FF" style={{ animation: "fade-in 400ms ease 840ms both" }}>
        <path d="M0 -5.6 C0.8 -5.6 1.5 -4.3 1.5 -2.8 L1.5 -1.4 L6.2 1.6 L6.2 3.2 L1.5 1.7 L1.5 3.8 L3 5 L3 6 L0 5.2 L-3 6 L-3 5 L-1.5 3.8 L-1.5 1.7 L-6.2 3.2 L-6.2 1.6 L-1.5 -1.4 L-1.5 -2.8 C-1.5 -4.3 -0.8 -5.6 0 -5.6 Z" />
      </g>
    </svg>
  );
}

export function SplashScreen() {
  // Hold a blank dark screen for a beat; only fade the animation in if we're still
  // loading after that. A fast load unmounts before this fires → no busy flash.
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 450);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative grid h-full w-full place-items-center overflow-hidden" style={{ background: "var(--bg)" }}>
      {show && (
        <>
          <div className="pointer-events-none absolute inset-0" style={{ animation: "fade-in 500ms ease both" }}>
            {FALLERS.map((f, i) => (
              <Faller key={i} f={f} />
            ))}
          </div>
          <div className="relative z-10 flex flex-col items-center gap-5" style={{ animation: "fade-in 500ms ease both" }}>
            <div className="animate-splash-mark">
              <CentreMark size={124} />
            </div>
            <div className="animate-splash-word font-display text-[2.2rem] font-bold tracking-[-0.02em] text-ink">Journia</div>
          </div>
        </>
      )}
    </div>
  );
}

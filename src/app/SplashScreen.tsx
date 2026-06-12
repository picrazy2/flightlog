import { useEffect, useRef, useState } from "react";

// Intro splash shown while flights load: a backgroundless Journia "J" sits centred
// while a stream of physical J's rains down and piles up at the bottom of the screen
// (matter-js), accumulating for as long as the load takes.

const J_PATH = "M43 16 L43 36 C43 44 36.5 48 27.5 45.6";

// One shared J texture (the gradient hook + amber origin node), tightly cropped so the
// physics body matches the visible glyph. Returns a PNG data URL.
const TEX_W = 116;
const TEX_H = 172;
function makeJTexture(): string {
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext("2d")!;
  const S = 4; // 64-space → texture px
  ctx.scale(S, S);
  ctx.translate(-20.5, -9.5); // crop to the J's bounding box (+padding)
  const g = ctx.createLinearGradient(43, 12, 27, 48);
  g.addColorStop(0, "#5B9DFF");
  g.addColorStop(1, "#2DD4BF");
  ctx.strokeStyle = g;
  ctx.lineWidth = 5.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(43, 16);
  ctx.lineTo(43, 36);
  ctx.bezierCurveTo(43, 44, 36.5, 48, 27.5, 45.6);
  ctx.stroke();
  ctx.fillStyle = "#FFC061";
  ctx.beginPath();
  ctx.arc(27.5, 45.6, 3.6, 0, Math.PI * 2);
  ctx.fill();
  return c.toDataURL();
}

// Spin up a matter-js world inside `el` that drops J's until torn down. Returns cleanup.
function runPile(Matter: any, el: HTMLElement): () => void {
  const { Engine, Render, Runner, Bodies, Composite, Body } = Matter;
  const W = el.clientWidth || window.innerWidth;
  const H = el.clientHeight || window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const engine = Engine.create();
  engine.gravity.y = 1.1;
  const render = Render.create({
    element: el,
    engine,
    options: { width: W, height: H, background: "transparent", wireframes: false, pixelRatio: dpr },
  });

  const texture = makeJTexture();
  // floor + side walls just outside the viewport so the pile stays on screen
  Composite.add(engine.world, [
    Bodies.rectangle(W / 2, H + 40, W + 400, 80, { isStatic: true }),
    Bodies.rectangle(-40, H / 2, 80, H * 3, { isStatic: true }),
    Bodies.rectangle(W + 40, H / 2, 80, H * 3, { isStatic: true }),
  ]);

  const drop = () => {
    if (Composite.allBodies(engine.world).length > 160) return; // safety cap
    const h = 26 + Math.random() * 36; // on-screen J height
    const scale = h / TEX_H;
    const bw = TEX_W * scale;
    const bh = TEX_H * scale;
    const x = W * 0.12 + Math.random() * W * 0.76;
    const body = Bodies.rectangle(x, -bh - 10, bw, bh, {
      friction: 0.45,
      frictionStatic: 0.7,
      restitution: 0.08,
      chamfer: { radius: Math.min(bw, bh) * 0.2 },
      angle: (Math.random() - 0.5) * 0.7,
      render: { sprite: { texture, xScale: scale, yScale: scale } },
    });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.22);
    Composite.add(engine.world, body);
  };

  const runner = Runner.create();
  Runner.run(runner, engine);
  Render.run(render);
  for (let i = 0; i < 3; i++) setTimeout(drop, i * 110); // initial burst
  const iv = setInterval(drop, 165);

  return () => {
    clearInterval(iv);
    Render.stop(render);
    Runner.stop(runner);
    render.canvas?.remove();
    render.textures = {};
    Composite.clear(engine.world, false);
    Engine.clear(engine);
  };
}

function CentreMark({ size = 124 }: { size?: number }) {
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
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 450);
    return () => clearTimeout(t);
  }, []);

  // physics pile — matter-js is lazy-loaded so it never bloats the initial bundle
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    let stop = () => {};
    import("matter-js")
      .then((m: any) => {
        if (cancelled || !stage.current) return;
        stop = runPile(m.default ?? m, stage.current);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stop();
    };
  }, [show]);

  return (
    <div className="relative grid h-full w-full place-items-center overflow-hidden" style={{ background: "var(--bg)" }}>
      {show && <div ref={stage} className="pointer-events-none absolute inset-0" style={{ animation: "fade-in 600ms ease both" }} />}
      {show && (
        <div className="relative z-10 flex flex-col items-center gap-5" style={{ animation: "fade-in 500ms ease both" }}>
          <div className="animate-splash-mark">
            <CentreMark size={124} />
          </div>
          <div className="animate-splash-word font-display text-[2.2rem] font-bold tracking-[-0.02em] text-ink">Journia</div>
        </div>
      )}
    </div>
  );
}

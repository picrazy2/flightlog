// Intro splash shown while flights load: the Journia mark draws itself in, the
// wordmark rises, and — if the load is still going — a row of dots bobs underneath.

// The brand mark, animated: the J-arc draws on, the origin node pops, the plane fades in.
function SplashMark({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <defs>
        <linearGradient id="sp-bg" x1="32" y1="2" x2="32" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1B2533" />
          <stop offset="1" stopColor="#0A0E15" />
        </linearGradient>
        <linearGradient id="sp-arc" x1="43" y1="12" x2="27" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5B9DFF" />
          <stop offset="1" stopColor="#2DD4BF" />
        </linearGradient>
        <radialGradient id="sp-amber" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFC061" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFC061" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#sp-bg)" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="17.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.08" />
      <g stroke="#7DB4FF" strokeOpacity="0.14" fill="none" strokeWidth="1.1">
        <circle cx="32" cy="32" r="20.5" />
        <ellipse cx="32" cy="32" rx="8" ry="20.5" />
      </g>
      <path
        d="M43 16 L43 36 C43 44 36.5 48 27.5 45.6"
        stroke="url(#sp-arc)"
        strokeWidth="5.5"
        strokeLinecap="round"
        fill="none"
        style={{ strokeDasharray: 64, animation: "draw 760ms cubic-bezier(.16,1,.3,1) 120ms both" }}
      />
      <circle cx="27.5" cy="45.6" r="7" fill="url(#sp-amber)" style={{ transformOrigin: "27.5px 45.6px", animation: "pop 500ms cubic-bezier(.16,1,.3,1) 740ms both" }} />
      <circle cx="27.5" cy="45.6" r="3.4" fill="#FFC061" stroke="#0A0E15" strokeWidth="1.4" style={{ transformOrigin: "27.5px 45.6px", animation: "pop 500ms cubic-bezier(.16,1,.3,1) 740ms both" }} />
      <g transform="translate(43 12) rotate(10)" fill="#EAF2FF" style={{ animation: "fade-in 400ms ease 820ms both" }}>
        <path d="M0 -5.6 C0.8 -5.6 1.5 -4.3 1.5 -2.8 L1.5 -1.4 L6.2 1.6 L6.2 3.2 L1.5 1.7 L1.5 3.8 L3 5 L3 6 L0 5.2 L-3 6 L-3 5 L-1.5 3.8 L-1.5 1.7 L-6.2 3.2 L-6.2 1.6 L-1.5 -1.4 L-1.5 -2.8 C-1.5 -4.3 -0.8 -5.6 0 -5.6 Z" />
      </g>
    </svg>
  );
}

export function SplashScreen({ loading }: { loading: boolean }) {
  return (
    <div className="grid h-full place-items-center" style={{ background: "#0A0C12" }}>
      <div className="flex flex-col items-center gap-5">
        <div className="animate-splash-mark">
          <SplashMark size={104} />
        </div>
        <div className="animate-splash-word font-display text-[2.2rem] font-bold tracking-[-0.02em] text-ink">Journia</div>
        {/* once the intro has played, if we're still loading, bob some dots */}
        <div className="h-2 opacity-0" style={{ animation: "fade-in 400ms ease 1.2s both" }}>
          {loading && (
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-ink-faint"
                  style={{ animation: "splash-bob 1.1s ease-in-out infinite", animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

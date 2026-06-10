// Journia brand mark — the "J" rendered as a flight path: a plane taking off at the
// top, arcing through the J hook to an amber origin node, over a faint globe.

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="jm-bg" x1="32" y1="2" x2="32" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1B2533" />
          <stop offset="1" stopColor="#0A0E15" />
        </linearGradient>
        <linearGradient id="jm-arc" x1="43" y1="12" x2="27" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5B9DFF" />
          <stop offset="1" stopColor="#2DD4BF" />
        </linearGradient>
        <radialGradient id="jm-amber" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFC061" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFC061" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#jm-bg)" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="17.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.08" />
      <g stroke="#7DB4FF" strokeOpacity="0.14" fill="none" strokeWidth="1.1">
        <circle cx="32" cy="32" r="20.5" />
        <ellipse cx="32" cy="32" rx="8" ry="20.5" />
      </g>
      <path d="M43 16 L43 36 C43 44 36.5 48 27.5 45.6" stroke="url(#jm-arc)" strokeWidth="5.5" strokeLinecap="round" fill="none" />
      <circle cx="27.5" cy="45.6" r="7" fill="url(#jm-amber)" />
      <circle cx="27.5" cy="45.6" r="3.4" fill="#FFC061" stroke="#0A0E15" strokeWidth="1.4" />
      <g transform="translate(43 12) rotate(10)" fill="#EAF2FF">
        <path d="M0 -5.6 C0.8 -5.6 1.5 -4.3 1.5 -2.8 L1.5 -1.4 L6.2 1.6 L6.2 3.2 L1.5 1.7 L1.5 3.8 L3 5 L3 6 L0 5.2 L-3 6 L-3 5 L-1.5 3.8 L-1.5 1.7 L-6.2 3.2 L-6.2 1.6 L-1.5 -1.4 L-1.5 -2.8 C-1.5 -4.3 -0.8 -5.6 0 -5.6 Z" />
      </g>
    </svg>
  );
}

// Full lockup for the header: mark + "Journia" in the display font.
export function Wordmark({ markSize = 30, className }: { markSize?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark size={markSize} />
      <span className="font-display font-semibold tracking-[-0.02em] text-ink" style={{ fontSize: markSize * 0.62 }}>
        Journia
      </span>
    </div>
  );
}

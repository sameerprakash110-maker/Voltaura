/**
 * VOLTAURA mark.
 *
 * Two nested hexagons offset from one another: the physical building and its
 * digital twin, with the gap between them -- the deviation -- picked out as
 * the accent. The whole product is about that gap.
 */
export function VOLTAURAMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
      role="presentation"
    >
      <defs>
        <linearGradient id="voltaura-mark-a" x1="4" y1="2" x2="28" y2="30">
          <stop offset="0%" stopColor="rgb(var(--mint))" />
          <stop offset="100%" stopColor="rgb(var(--aqua))" />
        </linearGradient>
      </defs>

      {/* the physical asset */}
      <path
        d="M13 3.6 L22.7 9.2 V20.4 L13 26 L3.3 20.4 V9.2 Z"
        stroke="rgb(var(--ink) / 0.32)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      {/* the twin, offset */}
      <path
        d="M19 6 L28.7 11.6 V22.8 L19 28.4 L9.3 22.8 V11.6 Z"
        stroke="url(#voltaura-mark-a)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        fill="rgb(var(--mint) / 0.08)"
      />
      {/* the deviation between them */}
      <circle cx="16" cy="16" r="2.4" fill="url(#voltaura-mark-a)" />
    </svg>
  );
}

export function VOLTAURAWordmark({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-3">
        <VOLTAURAMark className="size-9" />
        <div className="leading-none">
          <div className="font-display text-xl font-semibold tracking-tight text-ink">
            VOLTAURA
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-ink-muted">
            AI-Powered Digital Twin
          </div>
        </div>
      </div>
    </div>
  );
}

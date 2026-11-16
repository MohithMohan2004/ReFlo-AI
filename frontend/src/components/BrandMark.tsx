/**
 * ReFlow mark ("Blocks"): three quarter-circles hand the curve from one block to the next, and
 * the flow ends as a single bead of treated water. Drawn on a 48-unit grid with a 2-unit gutter
 * and set on a white tile, the same as static/brand-mark.svg.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flex: `0 0 ${size}px` }}>
      <rect width="48" height="48" rx="12" fill="#fff" />
      <rect x=".5" y=".5" width="47" height="47" rx="11.5" fill="none" stroke="#0b3d91" strokeOpacity=".12" />
      <g transform="translate(9.12 9.12) scale(.62)">
        <path d="M23 23H0A23 23 0 0 1 23 0Z" fill="#1463d6" />
        <path d="M25 0H48A23 23 0 0 1 25 23Z" fill="#38bdf8" />
        <path d="M0 25A23 23 0 0 1 23 48H0Z" fill="#7dd3fc" />
        <circle cx="36.5" cy="36.5" r="10.5" fill="#0b3d91" />
      </g>
    </svg>
  );
}

/** The product name, set in Sora: "Re" in ink, "Flow" in the brand gradient. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} aria-label="ReFlow">
      Re<span>Flow</span>
    </span>
  );
}

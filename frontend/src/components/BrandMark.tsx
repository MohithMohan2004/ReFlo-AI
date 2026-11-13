import { useId } from "react";

const MARK_PATHS = [
  "M10.6 36L14.32 12.5L20.32 12.5C23.5 12.5 25.66 15.07 25.16 18.25C24.66 21.43 21.68 24 18.5 24M18 24L21.6 36",
  "M28.6 36L31.37 18.5C31.9 15.19 35.01 12.5 38.32 12.5L38.82 12.5",
  "M12.5 24L36.5 24",
];

/**
 * ReFlow mark: an "Rf" ligature leaning forward. The bottom of the R's bowl runs on as the f's
 * crossbar, and the tile splits there: a sky above, deep-sea water below (with a ripple and bubbles).
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  const letters = MARK_PATHS.map((d) => <path key={d} d={d} />);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flex: `0 0 ${size}px` }}>
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#0284c7" />
        </linearGradient>
        <linearGradient id={`water-${id}`} x1="0" y1="24" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id={`sheen-${id}`} x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".18" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`tile-${id}`}>
          <rect width="48" height="48" rx="13" />
        </clipPath>
      </defs>
      <g clipPath={`url(#tile-${id})`}>
        <rect width="48" height="24" fill={`url(#sky-${id})`} />
        <rect y="24" width="48" height="24" fill={`url(#water-${id})`} />
        <rect y="24" width="48" height="5" fill="#fff" opacity=".08" />
        <path d="M-2 31.5c4-1.6 8-1.6 12 0s8 1.6 12 0s8-1.6 12 0s8 1.6 12 0s8-1.6 12 0" fill="none" stroke="#fff" strokeWidth="1" opacity=".22" />
        <path d="M38.4,38a1.6,1.6 0 1,0 3.2,0a1.6,1.6 0 1,0 -3.2,0zM35.5,42.5a1,1 0 1,0 2,0a1,1 0 1,0 -2,0zM7.8,41a1.2,1.2 0 1,0 2.4,0a1.2,1.2 0 1,0 -2.4,0z" fill="#fff" opacity=".28" />
        <rect width="48" height="48" fill={`url(#sheen-${id})`} />
      </g>
      <rect x=".5" y=".5" width="47" height="47" rx="12.5" fill="none" stroke="#fff" strokeOpacity=".16" />
      <g fill="none" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
        <g stroke="#0b1a4a" opacity=".22" transform="translate(0 .9)">
          {letters}
        </g>
        <g stroke="#fff">{letters}</g>
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

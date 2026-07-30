import type React from 'react';

export interface SomulMarkProps {
  size?: number;
  className?: string;
}

/**
 * The Somul wordmark glyph: five bars rising and falling, the shape of a level meter.
 *
 * Drawn inline rather than loaded as a file so the gradient renders identically to the app icon
 * without a network or asset round trip, and so it cannot flash empty on first paint.
 *
 * The gradient is permitted here — this is the header mark, one of the few places it is allowed.
 * The bars are filled shapes, not stroke icons, so filling them does not break `currentColor`
 * the way gradient-filling a Lucide glyph would.
 */
export const SomulMark: React.FC<SomulMarkProps> = ({ size = 20, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    <defs>
      <linearGradient id="somul-mark-gradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#293681" />
        <stop offset="55%" stopColor="#4274d9" />
        <stop offset="100%" stopColor="#95ccdd" />
      </linearGradient>
    </defs>

    <g fill="url(#somul-mark-gradient)">
      <rect x="1.5" y="9" width="3" height="6" rx="1.5" />
      <rect x="6" y="6" width="3" height="12" rx="1.5" />
      <rect x="10.5" y="3" width="3" height="18" rx="1.5" />
      <rect x="15" y="6" width="3" height="12" rx="1.5" />
      <rect x="19.5" y="9" width="3" height="6" rx="1.5" />
    </g>
  </svg>
);

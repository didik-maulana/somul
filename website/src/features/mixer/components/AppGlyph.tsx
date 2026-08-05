import type React from "react";

interface AppGlyphProps {
  name: string;
  accent: string;
}

export const AppGlyph: React.FC<AppGlyphProps> = ({ name, accent }) => (
  <span
    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-semibold text-white/90"
    style={{
      background: `linear-gradient(150deg, ${accent}59 0%, ${accent}1f 100%)`,
      boxShadow: `inset 0 0 0 1px ${accent}4d`,
    }}
    aria-hidden
  >
    {name.charAt(0)}
  </span>
);

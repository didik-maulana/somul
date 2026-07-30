import type React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Theme } from "@/types/ipc";

export interface ThemeSwitcherProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

const OPTIONS: { value: Theme; label: string; Icon: typeof Monitor }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
];

/**
 * A segmented control with a pill that travels between options.
 *
 * The track is a grid of **equal** columns, which is load-bearing rather than cosmetic. Sized by
 * their own text, "System" is wider than "Dark", so a pill of fixed width translating by
 * multiples of itself lands beside the option instead of on it — the misalignment is what read as
 * a janky slide. Equal columns make one third exact.
 *
 * Icons rather than words: three labels do not fit beside the row text in a 360 px panel without
 * crowding, and Sun, Moon, and Monitor are unambiguous. The accessible name still says the word.
 */
export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({
  theme,
  onThemeChange,
}) => {
  const activeIndex = Math.max(
    OPTIONS.findIndex((option) => option.value === theme),
    0,
  );

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="bg-muted border-border card-raised relative grid shrink-0 grid-cols-3 gap-0 rounded-md border p-0.5"
    >
      <span
        aria-hidden="true"
        data-testid="theme-indicator"
        className={cn(
          // `card` is lighter than `muted` in light theme but DARKER in dark theme, so a plain
          // `bg-card` pill sank into the track instead of lifting off it. `secondary` is the
          // token that sits above `muted` in the dark ramp.
          "absolute inset-y-0.5 left-0.5 rounded-[5px]",
          "bg-card dark:bg-secondary",
          // A hardcoded black shadow tuned for dark theme reads as grime on a near-white
          // track. `card-raised` is the light-theme elevation; in dark the fill and ring already
          // separate the pill, so it drops the shadow entirely.
          "ring-primary-stroke/40 card-raised ring-1",
          "transition-transform duration-[220ms] ease-[var(--ease-decelerate)] will-change-transform",
          "motion-reduce:transition-none",
        )}
        style={{
          width: `calc((100% - 0.25rem) / ${OPTIONS.length.toString()})`,
          transform: `translateX(${(activeIndex * 100).toString()}%)`,
        }}
      />

      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = value === theme;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            title={label}
            onClick={() => {
              onThemeChange(value);
            }}
            className={cn(
              "relative z-10 flex size-7 items-center justify-center rounded-[5px]",
              "transition-colors duration-[220ms]",
              // Colour carries the selected state, which is exactly what the palette reserves it
              // for. Two near-identical greys are not enough to read at a glance in dark theme.
              isActive
                ? "text-primary-stroke"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={15} strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
};

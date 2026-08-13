"use client";

import type React from "react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type SliderTone = "app" | "master";

interface VolumeSliderProps {
  value: number;
  label: string;
  tone?: SliderTone;
  dimmed?: boolean;
  onChange: (value: number) => void;
}

const STEP = 0.05;
const KNOB_SIZE = 14;

const TONE_FILL: Record<SliderTone, string> = {
  app: "bg-brand-600",
  master: "bg-gradient-to-r from-brand-800 via-brand-500 to-signal-300",
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export const VolumeSlider: React.FC<VolumeSliderProps> = ({
  value,
  label,
  tone = "app",
  dimmed = false,
  onChange,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const commitFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const bounds = track.getBoundingClientRect();
      onChange(clamp((clientX - bounds.left) / bounds.width));
    },
    [onChange],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    commitFromPointer(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    commitFromPointer(event.clientX);
  };

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? STEP
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -STEP
          : 0;
    if (delta !== 0) {
      event.preventDefault();
      onChange(clamp(value + delta));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(1);
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={`${label} volume`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${Math.round(value * 100)} percent`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={handleKeyDown}
      className="group relative h-3.5 flex-1 cursor-pointer touch-none select-none"
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/12">
        <div
          className={cn(
            "h-full w-full origin-left rounded-full",
            dimmed ? "bg-ink-600/45" : TONE_FILL[tone],
          )}
          style={{ transform: `scaleX(${value})` }}
        />
      </div>
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-[#FCFCFD] shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-transform duration-150",
          dimmed && "opacity-60",
          dragging ? "scale-115" : "group-hover:scale-110",
        )}
        style={{ left: `${value * 100}%`, width: KNOB_SIZE, height: KNOB_SIZE }}
      />
    </div>
  );
};

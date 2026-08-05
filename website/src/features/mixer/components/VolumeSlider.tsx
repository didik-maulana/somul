"use client";

import type React from "react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface VolumeSliderProps {
  value: number;
  accent: string;
  label: string;
  dimmed?: boolean;
  onChange: (value: number) => void;
}

const STEP = 0.05;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export const VolumeSlider: React.FC<VolumeSliderProps> = ({
  value,
  accent,
  label,
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
      className={cn(
        "group relative h-8 cursor-pointer touch-none select-none",
        dimmed && "opacity-45",
      )}
    >
      <div className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full w-full origin-left rounded-full"
          style={{
            transform: `scaleX(${value})`,
            background: `linear-gradient(90deg, ${accent}66 0%, ${accent} 100%)`,
          }}
        />
      </div>
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.55)] transition-[box-shadow,scale] duration-150",
          dragging ? "scale-115 shadow-[0_4px_18px_rgba(0,0,0,0.7)]" : "group-hover:scale-110",
        )}
        style={{ left: `${value * 100}%` }}
      />
    </div>
  );
};

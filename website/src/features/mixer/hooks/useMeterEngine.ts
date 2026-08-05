"use client";

import { useEffect, useRef, useState } from "react";
import { envelope, smoothPeak } from "@/lib/audio";
import type { DemoApp } from "@/content/types";

type MeterLevels = Record<string, number>;

const FRAME_INTERVAL = 1000 / 30;

const initialLevels = (apps: DemoApp[]): MeterLevels =>
  Object.fromEntries(apps.map((app) => [app.id, 0]));

export const useMeterEngine = (apps: DemoApp[], enabled: boolean): MeterLevels => {
  const [levels, setLevels] = useState<MeterLevels>(() => initialLevels(apps));
  const appsRef = useRef(apps);
  const levelsRef = useRef<MeterLevels>(levels);

  appsRef.current = apps;

  useEffect(() => {
    if (!enabled) {
      const silent = initialLevels(appsRef.current);
      levelsRef.current = silent;
      setLevels(silent);
      return;
    }

    let frame = 0;
    let lastEmit = 0;
    const start = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastEmit < FRAME_INTERVAL) return;
      lastEmit = now;

      const seconds = (now - start) / 1000;
      const next: MeterLevels = {};
      appsRef.current.forEach((app, index) => {
        const target = app.muted ? 0 : envelope(seconds, index + 1) * app.activity * app.volume;
        next[app.id] = smoothPeak(levelsRef.current[app.id] ?? 0, target);
      });
      levelsRef.current = next;
      setLevels(next);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  return levels;
};

"use client";

import { useCallback, useState } from "react";
import { DEMO_APPS } from "@/content/site";
import type { DemoApp } from "@/content/types";

interface MixerState {
  apps: DemoApp[];
  master: number;
  setVolume: (id: string, volume: number) => void;
  toggleMute: (id: string) => void;
  setMaster: (volume: number) => void;
}

export const useMixerState = (): MixerState => {
  const [apps, setApps] = useState<DemoApp[]>(DEMO_APPS);
  const [master, setMaster] = useState(0.8);

  const setVolume = useCallback((id: string, volume: number) => {
    setApps((current) =>
      current.map((app) => (app.id === id ? { ...app, volume, muted: false } : app)),
    );
  }, []);

  const toggleMute = useCallback((id: string) => {
    setApps((current) =>
      current.map((app) => (app.id === id ? { ...app, muted: !app.muted } : app)),
    );
  }, []);

  return { apps, master, setVolume, toggleMute, setMaster };
};

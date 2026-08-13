"use client";

import { useCallback, useState } from "react";
import { DEMO_APPS, MASTER_VOLUME } from "@/content/site";
import type { DemoApp } from "@/content/types";

interface MixerState {
  apps: DemoApp[];
  master: number;
  masterMuted: boolean;
  setVolume: (id: string, volume: number) => void;
  toggleMute: (id: string) => void;
  setMaster: (volume: number) => void;
  toggleMasterMute: () => void;
}

export const useMixerState = (): MixerState => {
  const [apps, setApps] = useState<DemoApp[]>(DEMO_APPS);
  const [master, setMasterVolume] = useState(MASTER_VOLUME);
  const [masterMuted, setMasterMuted] = useState(false);

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

  const setMaster = useCallback((volume: number) => {
    setMasterVolume(volume);
    setMasterMuted(false);
  }, []);

  const toggleMasterMute = useCallback(() => setMasterMuted((current) => !current), []);

  return { apps, master, masterMuted, setVolume, toggleMute, setMaster, toggleMasterMute };
};

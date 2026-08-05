import type {
  DemoApp,
  Feature,
  NavLink,
  PlatformRow,
  PrivacyStat,
  Step,
} from "@/content/types";

export const SITE = {
  name: "Somul",
  expansion: "Sound Multiplexer",
  tagline: "Per-app volume, right in your menu bar.",
  description:
    "Somul is an ultra-light per-application audio mixer for macOS. Pull Spotify down without touching Zoom. Nothing leaves your machine.",
  version: "1.1.0",
  repo: "https://github.com/didik-maulana/somul",
  download: "https://github.com/didik-maulana/somul/releases/latest",
  requirement: "macOS 14.4+ · Apple Silicon & Intel · 6 MB",
} as const;

export const NAV_LINKS: NavLink[] = [
  { label: "Mixer", href: "#mixer" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Platforms", href: "#platforms" },
  { label: "Privacy", href: "#privacy" },
];

export const DEMO_APPS: DemoApp[] = [
  { id: "spotify", name: "Spotify", accent: "#1db954", volume: 0.34, muted: false, activity: 0.9 },
  { id: "chrome", name: "Chrome", accent: "#4274d9", volume: 0.72, muted: false, activity: 0.55 },
  { id: "zoom", name: "Zoom", accent: "#95ccdd", volume: 1, muted: false, activity: 0.72 },
  { id: "discord", name: "Discord", accent: "#8fafe8", volume: 0.55, muted: true, activity: 0.4 },
];

export const FEATURES: Feature[] = [
  {
    id: "sliders",
    icon: "SlidersVertical",
    title: "One slider per app",
    body: "Spotify, Chrome, Zoom, Discord, your game — each gets its own fader and its own mute. Move one, the rest stay exactly where you left them.",
    span: "wide",
  },
  {
    id: "tray",
    icon: "PanelTop",
    title: "Tray-first, window-never",
    body: "The panel drops out of the menu bar, does its job, and disappears. No dock icon, no window to manage.",
  },
  {
    id: "meters",
    icon: "AudioLines",
    title: "Realtime peak meters",
    body: "A 30 Hz meter per row, driven straight off the render callback — so you can see which app is actually making the noise.",
  },
  {
    id: "hotkey",
    icon: "Command",
    title: "Global hotkey",
    body: "⌘⇧V from anywhere. Full-screen apps included.",
  },
  {
    id: "memory",
    icon: "Save",
    title: "Remembers every app",
    body: "Set Spotify to 30% once. It comes back at 30% next launch, and the launch after that.",
  },
  {
    id: "private",
    icon: "ShieldCheck",
    title: "Local by construction",
    body: "No account, no telemetry, no network calls beyond the update check you can switch off.",
    span: "wide",
  },
  {
    id: "master",
    icon: "Gauge",
    title: "System output, same panel",
    body: "The top row is the master volume, so you never bounce between Somul and Sound settings.",
  },
];

export const STEPS: Step[] = [
  {
    id: "enumerate",
    index: "01",
    title: "Find what is playing",
    body: "Core Audio is asked which processes hold an open output stream. Somul waits for sustained output before an app claims a row, so a one-off system chirp never takes over the panel.",
  },
  {
    id: "tap",
    index: "02",
    title: "Tap the process",
    body: "macOS has no per-app volume API, so Somul installs a Core Audio process tap — the app's audio is routed through an aggregate device that Somul owns.",
  },
  {
    id: "scale",
    index: "03",
    title: "Scale in the render callback",
    body: "Gain is applied inside the realtime render path, sample by sample. Every tap starts in passthrough and only takes an app over once Somul has actually heard it.",
  },
];

export const PLATFORMS: PlatformRow[] = [
  {
    id: "macos-current",
    platform: "macOS 14.4+",
    detail: "Core Audio process taps",
    status: "shipping",
    statusLabel: "Shipping",
  },
  {
    id: "macos-legacy",
    platform: "macOS ≤ 14.3",
    detail: "Master volume and metering only — the tap API does not exist",
    status: "partial",
    statusLabel: "Partial",
  },
  {
    id: "windows",
    platform: "Windows 10 1803+",
    detail: "Needs an AudioBackend over WASAPI ISimpleAudioVolume",
    status: "next",
    statusLabel: "Next",
  },
  {
    id: "linux",
    platform: "Linux · PipeWire / PulseAudio",
    detail: "Also the only platform that can do native per-app routing",
    status: "next",
    statusLabel: "Next",
  },
];

export const PRIVACY_STATS: PrivacyStat[] = [
  { id: "telemetry", value: "0", label: "analytics events" },
  { id: "accounts", value: "0", label: "accounts to create" },
  { id: "cloud", value: "0", label: "cloud dependencies" },
  { id: "audio", value: "0", label: "bytes of audio stored" },
];

export const PRIVACY_NOTE =
  "Per-app volume runs on Core Audio process taps, and a tap is audio capture — so macOS asks for the audio-recording permission. Somul reads those samples to draw a meter and to scale gain. They are never written to disk and never leave the process.";

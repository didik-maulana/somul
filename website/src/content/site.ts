import type {
  Callout,
  DemoApp,
  FaqEntry,
  Feature,
  FlowNode,
  MiniMixerRow,
  NavLink,
  PrivacyFact,
  Step,
} from "@/content/types";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;

if (!appVersion) {
  throw new Error("NEXT_PUBLIC_APP_VERSION is unset; next.config.ts reads it from src-tauri/tauri.conf.json");
}

export const APP_VERSION = appVersion;

export const SITE = {
  name: "Somul",
  tagline: "Per-app volume, right in your menu bar.",
  description: "Every app making noise gets its own slider, right in your menu bar.",
  version: APP_VERSION,
  url: "https://somul.app",
  repo: "https://github.com/didik-maulana/somul",
  download:
    process.env.NEXT_PUBLIC_DOWNLOAD_URL ??
    "https://github.com/didik-maulana/somul/releases/latest/download/Somul.dmg",
  requirement: "macOS 14.4+ · Universal binary",
  hotkey: ["⌘", "Shift", "V"],
} as const;

export const NAV_LINKS: NavLink[] = [
  { label: "Mixer", href: "#mixer" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Privacy", href: "#privacy" },
  { label: "FAQ", href: "#faq" },
];

export const MASTER_DEVICE = "MacBook Pro Speakers";

export const MASTER_VOLUME = 0.8;

export const DEMO_APPS: DemoApp[] = [
  { id: "spotify", name: "Spotify", volume: 0.34, muted: false },
  { id: "chrome", name: "Chrome", volume: 0.72, muted: false },
  { id: "zoom", name: "Zoom", volume: 1, muted: false },
  { id: "discord", name: "Discord", volume: 0.45, muted: true },
];

export const SHOWCASE_CALLOUTS: Callout[] = [
  {
    id: "level",
    title: "Every row shows its real level",
    body: "Set Spotify to 34 percent and the number beside the fader reads 34%. No guessing where it landed.",
  },
  {
    id: "mute",
    title: "Mute without losing your place",
    body: "The speaker icon silences one app and leaves its level untouched. Click it again and the app comes back exactly where it was.",
  },
  {
    id: "local",
    title: "No account, no telemetry",
    body: "The only connection Somul makes is a signed update check at launch. Your levels stay in a settings file on your Mac, and installing a build is always a button you press.",
  },
];

export const FEATURE_FADER: Feature = {
  id: "fader",
  icon: "SlidersVertical",
  title: "One fader per app",
  body: "Spotify, Chrome, Zoom, your game. Each one gets its own fader and its own mute. Move one and the rest stay where you left them.",
};

export const FEATURE_HOTKEY: Feature = {
  id: "hotkey",
  icon: "Command",
  title: "One hotkey, from anywhere",
  body: "The panel opens over full screen apps and games without stealing focus. Set your level, let go, and it is gone.",
};

export const FEATURES: Feature[] = [
  {
    id: "tray",
    icon: "PanelTop",
    title: "Lives in your menu bar",
    body: "Click the icon, set your levels, click away. No dock icon, no window to manage.",
  },
  {
    id: "memory",
    icon: "Save",
    title: "Remembers your levels",
    body: "Set Spotify to 30% once. It opens at 30% next time, and every time after that.",
  },
  {
    id: "master",
    icon: "Gauge",
    title: "Master volume up top",
    body: "The first row is your overall volume, so you never open Sound settings just to turn things down.",
  },
];

export const MINI_MIXER_ROWS: MiniMixerRow[] = [
  { id: "spotify", label: "SPOTIFY", value: 34, tone: "brand" },
  { id: "zoom", label: "ZOOM", value: 82, tone: "mint" },
  { id: "chrome", label: "CHROME", value: 58, tone: "signal" },
];

export const STEPS: Step[] = [
  {
    id: "notice",
    index: "01",
    title: "It notices what is playing",
    body: "Somul watches which apps are making sound and gives each one a row. Quiet apps stay out of the list until they speak up.",
  },
  {
    id: "pass",
    index: "02",
    title: "Sound passes through Somul",
    body: "On its way out of the app, audio takes a short detour through Somul and carries on to your speakers. Your output device and sound settings stay exactly as they were.",
  },
  {
    id: "level",
    index: "03",
    title: "Your fader sets the level",
    body: "Move a fader and that app gets quieter the moment the sound passes through. Nothing else on your Mac changes.",
  },
];

export const FLOW_NODES: FlowNode[] = [
  { id: "app", label: "The app plays", hint: "SPOTIFY, ZOOM, A GAME" },
  { id: "pass", label: "Somul takes a pass", hint: "AUDIO STREAM, NOT A RECORDING" },
  { id: "fader", label: "Your fader is applied", hint: "INSTANT, PER APP" },
  { id: "out", label: "Your speakers", hint: "SAME DEVICE, SAME LATENCY" },
];

export const PRIVACY_NOTE =
  "Somul changes an app's volume by tapping its audio stream. macOS counts every tap as recording, so it shows the microphone prompt. Somul reads each sample, moves the fader, and drops it.";

export const PRIVACY_FACTS: PrivacyFact[] = [
  { id: "disk", icon: "HardDrive", label: "Saved to disk", value: "Never", tone: "mint" },
  { id: "network", icon: "Radio", label: "Sent anywhere", value: "Never", tone: "mint" },
  {
    id: "telemetry",
    icon: "ChartNoAxesColumn",
    label: "Analytics or telemetry",
    value: "None",
    tone: "mint",
  },
  { id: "account", icon: "User", label: "Account to sign in", value: "None", tone: "mint" },
  { id: "update", icon: "RefreshCw", label: "Update check", value: "Optional", tone: "signal" },
];

export const FAQS: FaqEntry[] = [
  {
    id: "permission",
    question: "Why does Somul ask to record audio?",
    answer:
      "Per-app volume runs on Core Audio process taps, and macOS counts a tap as audio capture. Nothing is recorded, stored, or sent anywhere — the sound is mixed on your Mac and played straight back out. Without the grant Somul still moves the master volume, but not one app on its own.",
  },
  {
    id: "free",
    question: "Is Somul really free?",
    answer: "Yes. No account, no trial timer, no paid tier. Download it and it's yours.",
  },
  {
    id: "system-volume",
    question: "Does it change my Mac's system volume?",
    answer:
      "No. Your system volume stays exactly where you left it. Somul only moves the level of the app you point it at.",
  },
  {
    id: "where",
    question: "Where does Somul live once it's running?",
    answer:
      "In your menu bar. No Dock icon, no window to keep open. Click the icon, move a slider, close it.",
  },
];

export const NOT_FOUND = {
  code: "404",
  title: "This page is muted.",
  description:
    "The page you're looking for doesn't exist, or it was moved. Slide the volume back up to take you home.",
  row: "somul.app/this-page",
  restoredTitle: "Volume restored.",
  restoredDescription: "Sound is back on the homepage. Taking you there now.",
} as const;

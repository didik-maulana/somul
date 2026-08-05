export interface NavLink {
  label: string;
  href: string;
}

export interface DemoApp {
  id: string;
  name: string;
  accent: string;
  volume: number;
  muted: boolean;
  activity: number;
}

export type FeatureSpan = "wide" | "tall";

export interface Feature {
  id: string;
  icon: string;
  title: string;
  body: string;
  span?: FeatureSpan;
}

export interface Step {
  id: string;
  index: string;
  title: string;
  body: string;
}

export type PlatformStatus = "shipping" | "partial" | "next";

export interface PlatformRow {
  id: string;
  platform: string;
  detail: string;
  status: PlatformStatus;
  statusLabel: string;
}

export interface PrivacyStat {
  id: string;
  value: string;
  label: string;
}

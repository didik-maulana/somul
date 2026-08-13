export interface NavLink {
  label: string;
  href: string;
}

export interface DemoApp {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
}

export interface Callout {
  id: string;
  title: string;
  body: string;
}

export interface Feature {
  id: string;
  icon: string;
  title: string;
  body: string;
}

export interface MiniMixerRow {
  id: string;
  label: string;
  value: number;
  tone: "brand" | "mint" | "signal";
}

export interface Step {
  id: string;
  index: string;
  title: string;
  body: string;
}

export interface FlowNode {
  id: string;
  label: string;
  hint: string;
}

export interface PrivacyFact {
  id: string;
  icon: string;
  label: string;
  value: string;
  tone: "mint" | "signal";
}

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

import type React from "react";
import {
  Command,
  Gauge,
  PanelTop,
  Save,
  SlidersVertical,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Feature } from "@/content/types";

const ICONS: Record<string, LucideIcon> = {
  SlidersVertical,
  PanelTop,
  Save,
  Gauge,
  Command,
};

interface FeatureBodyProps {
  feature: Feature;
  className?: string;
}

export const FeatureBody: React.FC<FeatureBodyProps> = ({ feature, className }) => {
  const Icon = ICONS[feature.icon] ?? SlidersVertical;

  return (
    <div className={cn("relative flex flex-col gap-5", className)}>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-hairline bg-surface-3 text-brand-300">
        <Icon size={18} strokeWidth={1.7} aria-hidden />
      </span>
      <div className="flex flex-col gap-2.5">
        <h3 className="text-[17px] font-medium tracking-[-0.01em] text-white">{feature.title}</h3>
        <p className="text-sm leading-relaxed text-ink-400">{feature.body}</p>
      </div>
    </div>
  );
};

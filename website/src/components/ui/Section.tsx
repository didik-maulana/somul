import type React from "react";
import { cn } from "@/lib/cn";

interface SectionProps {
  id?: string;
  children: React.ReactNode;
  innerClassName?: string;
}

export const Section: React.FC<SectionProps> = ({ id, children, innerClassName }) => (
  <section id={id} className="relative px-6 py-28 sm:px-10">
    <div className={cn("mx-auto w-full max-w-7xl", innerClassName)}>{children}</div>
  </section>
);

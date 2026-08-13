import type React from "react";
import { cn } from "@/lib/cn";

interface SectionProps {
  id?: string;
  children: React.ReactNode;
  innerClassName?: string;
}

export const Section: React.FC<SectionProps> = ({ id, children, innerClassName }) => (
  <section id={id} className="relative overflow-hidden px-5 py-20 sm:px-10 sm:py-28">
    <div className={cn("mx-auto w-full max-w-7xl", innerClassName)}>{children}</div>
  </section>
);

import type React from "react";
import { Logo } from "@/components/ui/Logo";
import { SITE } from "@/content/site";

const FOOTER_LINKS = [
  { label: "GitHub", href: SITE.repo },
  { label: "Releases", href: `${SITE.repo}/releases` },
  { label: "Report an issue", href: `${SITE.repo}/issues` },
];

export const SiteFooter: React.FC = () => (
  <footer className="border-t border-line-faint px-6 py-9 sm:px-10">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-5">
        <span className="flex items-center gap-2.5">
          <Logo animate={false} />
          <span className="text-[15px] font-semibold tracking-tight text-white">{SITE.name}</span>
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-500">
          © {new Date().getFullYear()} · MIT licensed
        </span>
      </div>

      <nav className="flex flex-wrap items-center gap-7">
        {FOOTER_LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-ink-400 transition-colors duration-150 hover:text-white"
          >
            {link.label}
          </a>
        ))}
      </nav>
    </div>
  </footer>
);

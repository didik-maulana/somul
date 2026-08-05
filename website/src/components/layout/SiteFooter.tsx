import type React from "react";
import { Logo } from "@/components/ui/Logo";
import { NAV_LINKS, SITE } from "@/content/site";

export const SiteFooter: React.FC = () => (
  <footer className="border-t border-white/[0.06] px-6 py-14 sm:px-10">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 md:flex-row md:items-start md:justify-between">
      <div className="flex max-w-sm flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <Logo animate={false} />
          <span className="text-[15px] font-semibold tracking-tight text-white">{SITE.name}</span>
        </div>
        <p className="text-sm leading-relaxed text-ink-500">{SITE.tagline}</p>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-700">
          MIT licensed · v{SITE.version}
        </p>
      </div>

      <nav className="flex flex-wrap gap-x-10 gap-y-3">
        <ul className="flex flex-col gap-2.5">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-sm text-ink-500 transition-colors duration-150 hover:text-white"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <ul className="flex flex-col gap-2.5">
          <li>
            <a
              href={SITE.repo}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-ink-500 transition-colors duration-150 hover:text-white"
            >
              GitHub
            </a>
          </li>
          <li>
            <a
              href={`${SITE.repo}/releases`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-ink-500 transition-colors duration-150 hover:text-white"
            >
              Releases
            </a>
          </li>
          <li>
            <a
              href={`${SITE.repo}/issues`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-ink-500 transition-colors duration-150 hover:text-white"
            >
              Report an issue
            </a>
          </li>
        </ul>
      </nav>
    </div>
  </footer>
);

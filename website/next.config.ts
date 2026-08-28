import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const root = path.dirname(new URL(import.meta.url).pathname);

/* The version the site advertises is the one the app ships, read from the app's own config so a
   release cannot leave the download page announcing the previous number. */
const appVersion = JSON.parse(
  readFileSync(path.join(root, "..", "src-tauri", "tauri.conf.json"), "utf8"),
).version as string;

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_VERSION: appVersion },
  /* The Tauri app has its own lockfile one level up; without this Next picks that as the root. */
  outputFileTracingRoot: root,
};

export default nextConfig;

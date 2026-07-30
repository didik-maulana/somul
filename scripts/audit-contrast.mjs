#!/usr/bin/env node
/**
 * Regenerates and asserts the contrast matrix in DESIGN.md §2.8.
 *
 * Token values are duplicated here rather than parsed out of index.css because
 * this script must be runnable before the frontend is scaffolded, and because a
 * silent parse failure would report "all pass" on an empty set.
 *
 *   node scripts/audit-contrast.mjs           print the matrix
 *   node scripts/audit-contrast.mjs --check   exit 1 on any failure (CI)
 */

const TOKENS = {
  dark: {
    background: "#0b0d12",
    foreground: "#eff1f5",
    card: "#12151b",
    popover: "#171a22",
    primary: "#345cb4",
    primaryForeground: "#ffffff",
    primaryStroke: "#4274d9",
    secondary: "#1e222c",
    secondaryForeground: "#c9ceda",
    muted: "#171a22",
    mutedForeground: "#9aa1b4",
    accent: "#1e222c",
    accentForeground: "#eff1f5",
    destructive: "#d0454c",
    destructiveForeground: "#ffffff",
    success: "#3fbf87",
    warning: "#e0a340",
    info: "#8fafe8",
    meterFloor: "#d0e7e6",
    meterMid: "#95ccdd",
    border: "#2a2f3c",
    input: "#636b80",
    ring: "#4274d9",
  },
  light: {
    background: "#f7f8fa",
    foreground: "#12151b",
    card: "#ffffff",
    popover: "#ffffff",
    primary: "#345cb4",
    primaryForeground: "#ffffff",
    primaryStroke: "#345cb4",
    secondary: "#ffffff",
    secondaryForeground: "#363c4b",
    muted: "#eff1f5",
    mutedForeground: "#5e667b",
    accent: "#eef3fc",
    accentForeground: "#293681",
    destructive: "#c8353c",
    destructiveForeground: "#ffffff",
    success: "#1e9b67",
    warning: "#b87a17",
    info: "#2e4a9a",
    meterFloor: "#4e7d7c",
    meterMid: "#3b7b92",
    border: "#e2e5ec",
    input: "#767e91",
    ring: "#4274d9",
  },
};

const AA_BODY = 4.5;
const NON_TEXT = 3;

/** [label, foregroundToken, backgroundToken, threshold] */
const TEXT_PAIRS = [
  ["`foreground` on `background`", "foreground", "background", AA_BODY],
  ["`foreground` on `card`", "foreground", "card", AA_BODY],
  ["`muted-foreground` on `card`", "mutedForeground", "card", AA_BODY],
  ["`muted-foreground` on `background`", "mutedForeground", "background", AA_BODY],
  ["`secondary-foreground` on `secondary`", "secondaryForeground", "secondary", AA_BODY],
  ["`accent-foreground` on `accent`", "accentForeground", "accent", AA_BODY],
  ["`primary-foreground` on `primary`", "primaryForeground", "primary", AA_BODY],
  ["`destructive-foreground` on `destructive`", "destructiveForeground", "destructive", AA_BODY],
  ["`info` on `card`", "info", "card", AA_BODY],
];

// success and warning are fill-and-icon colors in light theme by design (§2.6),
// so they are held to the non-text threshold rather than AA body.
const SPLIT_PAIRS = [
  ["`success` on `card`", "success", "card", { dark: AA_BODY, light: NON_TEXT }],
  ["`warning` on `card`", "warning", "card", { dark: AA_BODY, light: NON_TEXT }],
];

const NON_TEXT_PAIRS = [
  ["`ring` on `card`", "ring", "card", NON_TEXT],
  ["`ring` on `background`", "ring", "background", NON_TEXT],
  ["`input` on `card`", "input", "card", NON_TEXT],
  ["`input` on `popover`", "input", "popover", NON_TEXT],
  ["Meter floor band on `muted`", "meterFloor", "muted", NON_TEXT],
  ["Meter mid band on `muted`", "meterMid", "muted", NON_TEXT],
  ["Meter warning band on `muted`", "warning", "muted", NON_TEXT],
  ["Meter clip band on `muted`", "destructive", "muted", NON_TEXT],
  ["`primary-stroke` on `card`", "primaryStroke", "card", NON_TEXT],
];

const EXEMPT_PAIRS = [
  // A filled control is identified by its label plus primaryStroke, not its own fill.
  ["`primary` on `card`", "primary", "card"],
  // border is a decorative hairline, exempt from WCAG 1.4.11 (§2.7).
  ["`border` on `card`", "border", "card"],
];

const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
  const raw = hex.replace("#", "");
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    parseInt(raw.slice(offset, offset + 2), 16),
  );
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
};

const ratio = (foreground, background) => {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const round = (value) => Math.round(value * 100) / 100;

const evaluate = (rows) =>
  rows.map(([label, foreground, background, threshold]) => {
    const perTheme = ["dark", "light"].map((theme) => {
      const tokens = TOKENS[theme];
      const required =
        typeof threshold === "object" ? threshold[theme] : threshold;
      const measured = round(ratio(tokens[foreground], tokens[background]));
      return { theme, measured, required, passes: measured >= required };
    });
    return { label, perTheme };
  });

const render = (title, results) => {
  const lines = [`\n${title}`, "| Pair | Dark | Light | Verdict |", "| :--- | :--- | :--- | :--- |"];
  for (const { label, perTheme } of results) {
    const [dark, light] = perTheme;
    const verdict = perTheme.every((entry) => entry.passes)
      ? "pass"
      : perTheme
          .filter((entry) => !entry.passes)
          .map((entry) => `FAIL ${entry.theme} (needs ${entry.required})`)
          .join(", ");
    lines.push(
      `| ${label} | ${dark.measured.toFixed(2)} | ${light.measured.toFixed(2)} | ${verdict} |`,
    );
  }
  return lines.join("\n");
};

const textResults = evaluate([...TEXT_PAIRS, ...SPLIT_PAIRS]);
const nonTextResults = evaluate(NON_TEXT_PAIRS);

console.log(render("Text pairs", textResults));
console.log(render("Non-text pairs", nonTextResults));

console.log("\nExempt (decorative hairlines, reported only)");
for (const [label, foreground, background] of EXEMPT_PAIRS) {
  const dark = round(ratio(TOKENS.dark[foreground], TOKENS.dark[background]));
  const light = round(ratio(TOKENS.light[foreground], TOKENS.light[background]));
  console.log(`  ${label}: ${dark.toFixed(2)} dark / ${light.toFixed(2)} light`);
}

const failures = [...textResults, ...nonTextResults].flatMap(({ label, perTheme }) =>
  perTheme
    .filter((entry) => !entry.passes)
    .map((entry) => `${label} [${entry.theme}] ${entry.measured} < ${entry.required}`),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} contrast failure(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
}

if (process.argv.includes("--check") && failures.length > 0) {
  process.exit(1);
}

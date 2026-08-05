# Somul — landing page

Marketing site for [Somul](../README.md). Separate from the desktop app: this folder has its own
`package.json` and never imports from `../src`, so the app build and the site build cannot break
each other.

```sh
npm install
npm run dev        # http://localhost:3000
npm run build      # static export into ./out
```

## Stack

| Piece | Choice | Why |
| :--- | :--- | :--- |
| Framework | Next.js 15, App Router | Static export, so the whole site is HTML on a CDN with no server to run |
| Styling | Tailwind CSS v4 | Same version and the same token names as the app, so the site cannot drift from the product's palette |
| Motion | `motion` (Framer Motion 12) | Scroll-linked values, layout animation, and a `useReducedMotion` hook that is honoured everywhere |
| Smooth scroll | Lenis | Makes scroll-linked motion read as continuous; disabled under `prefers-reduced-motion` |
| Icons | lucide-react | Same icon set as the app |

## Structure

```
src/
  app/            layout, page, global stylesheet
  components/     ui/ primitives and layout/ chrome shared across sections
  content/        all copy and section data, plus its types
  features/       one folder per section: hero, showcase, features, how, platforms, privacy, download
  lib/            cn, motion tokens, the meter maths
```

Copy lives in `src/content/site.ts`. Editing a headline, a feature, or a platform row is a data
change — no component has to be touched.

## Design tokens

Colour ramps, radii, and easing curves in `src/app/globals.css` are copied from the app's
`DESIGN.md`. The fonts in `public/fonts` are the same files the app ships, so the site never
reaches out to Google Fonts.

## Motion rules

- Only `transform` and `opacity` are animated.
- Peak meters are untransitioned — a CSS transition would smear a 30 Hz signal.
- Every looping animation checks `useReducedMotion` and falls back to a static frame.

## Deploying

`npm run build` writes a static site to `out/`. It works on Vercel, Netlify, Cloudflare Pages, or
GitHub Pages as-is. For GitHub Pages on a project path, set `basePath` in `next.config.ts`.

<p align="center">
  <img src="website/public/icon.svg" alt="Somul" width="112" />
</p>

<h1 align="center">Somul</h1>

<p align="center"><strong>Per-app volume, right in your menu bar.</strong></p>

<p align="center">
  <a href="https://tauri.app"><img src="https://img.shields.io/badge/Built%20with-Tauri%20v2-blue?logo=tauri" alt="Built with Tauri" /></a>
  <a href="https://www.rust-lang.org"><img src="https://img.shields.io/badge/Powered%20by-Rust-orange?logo=rust" alt="Powered by Rust" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Platform-macOS%2014.4%2B-lightgrey?logo=apple" alt="macOS 14.4+" />
</p>

<p align="center">
  <a href="docs/media/somul-promo.mp4"><img src="docs/media/somul-promo.webp" alt="Somul promo" width="800" /></a><br />
  <sub><a href="docs/media/somul-promo.mp4">Watch with sound (mp4)</a> · <a href="https://somul.app">somul.app</a></sub>
</p>

Every app making noise gets its own slider. Spotify, Chrome, Zoom, Discord, your game — set each
one where you want it, mute the one you don't, and the rest stay where you left them. No dock
icon, no window to manage: click the menu bar icon or press **⌘ Shift V**, set your levels, click
away.

## Features

- **One fader per app** — every app with an open audio stream gets a row with its own slider, mute, and live level.
- **Master volume up top** — output device and system volume in the first row, so you never open Sound settings just to turn things down.
- **Lives in your menu bar** — instant pop-up panel, global hotkey, opens over full-screen apps without stealing focus.
- **Remembers your levels** — set Spotify to 30% once and it opens at 30% every time after.
- **Nothing leaves your Mac** — no account, no telemetry. The only connection is a signed update check at launch.

## Install

Requires **macOS 14.4 or newer**.

1. Download `Somul.dmg` from the [latest release](https://github.com/didik-maulana/somul/releases/latest).
2. Open it and drag Somul to Applications.
3. Somul is not notarized yet, so remove the quarantine flag once:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Somul.app
   ```

   Or, after the first blocked launch: **System Settings → Privacy & Security → Open Anyway**.

4. Allow Somul under **System Settings → Privacy & Security → Audio Recording** when asked.
   Per-app volume runs on Core Audio process taps, and macOS treats a tap as audio capture.
   Without it Somul still controls the master volume and lists apps, but cannot move them
   individually.

Because the build is unsigned, macOS forgets the audio permission on every update and Somul will
ask again. Updates themselves are checked at launch and installed only when you say so.

Prefer to build it yourself? `npm ci && npm run tauri build`. A build signed with your own identity
needs no quarantine removal and keeps the permission across rebuilds — see
[`scripts/create-dev-signing-identity.sh`](scripts/create-dev-signing-identity.sh).

## Development

```sh
npm ci
npm run tauri dev     # run the app
npm run verify        # typecheck, lint, vitest, clippy, cargo test
```

- **Backend:** Tauri v2 (Rust), Core Audio process taps behind an `AudioBackend` trait.
- **Frontend:** React 19, TypeScript, Vite, Tailwind v4, shadcn/ui, Zustand.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for how audio flows through the app and
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Releasing

Set the same `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, commit, then:

```sh
git tag v1.0.0 && git push origin v1.0.0
```

`.github/workflows/release.yml` builds a universal binary, signs and notarizes it, and publishes a
**draft** release with the `.dmg`, the `.app.tar.gz`, its signature, and `latest.json`. Installed
copies only see the update once the draft is published. Artifacts are signed with the updater key
whose public half (`333AAEBC95206741`) is compiled into every build; the secrets the workflow needs
are listed at the top of that file.

## License

[MIT](LICENSE)

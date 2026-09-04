<p align="center">
  <img src="website/public/icon.svg" alt="Somul" width="112" />
</p>

<h1 align="center">Somul</h1>

<p align="center"><strong>Per-app volume, right in your menu bar.</strong></p>

<p align="center">
  <a href="https://somul.app">somul.app</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/didik-maulana/somul/releases/latest">Download</a>
  &nbsp;·&nbsp;
  <a href="ARCHITECTURE.md">Architecture</a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://tauri.app"><img src="https://img.shields.io/badge/Built%20with-Tauri%20v2-blue?logo=tauri" alt="Built with Tauri" /></a>
  <a href="https://www.rust-lang.org"><img src="https://img.shields.io/badge/Powered%20by-Rust-orange?logo=rust" alt="Powered by Rust" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Platform-macOS%2014.4%2B-lightgrey?logo=apple" alt="macOS 14.4+" />
</p>

Every app making noise gets its own slider. Spotify, Chrome, Zoom, Discord, your game: set each
one where you want it, mute the one you don't, and the rest stay where you left them. There is no
dock icon and no window to manage. Click the menu bar icon or press **⌘ Shift V**, set your
levels, click away.

Learn more at [somul.app](https://somul.app).

## What it does

**One fader per app.** Every app that is playing sound gets a row with its own slider and mute
button.

**A level meter on every row.** A segmented bar under each slider shows what that app is
actually sending to the speaker, so you can see which one is making noise before you touch
anything. Switch it off in Settings if you only want the sliders.

**Send each app to its own output.** Music on the desk speakers while the call stays on your
headphones. Pick a device on any row and it sticks; leave it on *System default* and it follows
whatever the Mac is using.

**Master volume up top.** The output device and system volume sit in the first row, so you never
open Sound settings just to turn things down.

**Lives in your menu bar.** The panel opens instantly, responds to a global hotkey, and appears
over full-screen apps without stealing focus.

**Remembers your levels.** Set Spotify to 30% once and it opens at 30% every time after.

**Nothing leaves your Mac.** No account, no telemetry. The only network connection is a signed
update check at launch.

## Install

Somul needs **macOS 14.4 or newer**.

1. Download `Somul.dmg` from the [latest release](https://github.com/didik-maulana/somul/releases/latest).
2. Open it and drag Somul to Applications.
3. Allow Somul under **System Settings → Privacy & Security → Audio Recording** when asked.

Per-app volume runs on Core Audio process taps, and macOS treats a tap as audio capture. Without
that permission Somul still controls the master volume and lists apps, but cannot move them
individually.

Releases are signed with a Developer ID and notarized, so the grant survives an update and macOS
opens the app without a detour through Privacy & Security. Updates are checked at launch and
installed only when you say so.

### Building it yourself

```sh
npm ci
npm run build:local
```

A build signed with your own identity keeps the audio permission across rebuilds; an ad-hoc one
loses it every time the binary changes.
[`scripts/create-dev-signing-identity.sh`](scripts/create-dev-signing-identity.sh) creates an
identity to sign with.

`build:local` is `tauri build` without the updater artifacts. Those are signed with a release key
that only the maintainer holds, so asking for them anywhere else ends a ten-minute build with a
complaint about a key you are not supposed to have.

## Development

```sh
npm ci
npm run tauri dev     # run the app
npm run verify        # typecheck, lint, vitest, clippy, cargo test
```

The backend is Tauri v2 in Rust, with Core Audio process taps behind an `AudioBackend` trait.
The frontend is React 19, TypeScript, Vite, Tailwind v4, shadcn/ui, and Zustand.

[ARCHITECTURE.md](ARCHITECTURE.md) explains how audio flows through the app and why it is shaped
the way it is.

## Contributing

Bug reports, feature ideas, and pull requests are welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md): it covers how to set up a working build, how the code is
organised, what `npm run verify` checks, and what a pull request needs before it can be merged.

If you are unsure whether a change fits, open an issue first and describe the problem you are
trying to solve.

## License

Somul is released under the [MIT License](LICENSE). You can use it, change it, and redistribute
it, commercially or not, as long as the copyright notice and license text travel with it. The
software is provided as is, without warranty.

Copyright © 2026 Didik Maulana.

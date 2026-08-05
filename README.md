# 🔊 Somul (Sound Multiplexer)

> **Ultra-lightweight per-app volume mixer and audio router. macOS today, Windows and Linux next.**

[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%20v2-blue?logo=tauri)](https://tauri.app)
[![Powered by Rust](https://img.shields.io/badge/Powered%20by-Rust-orange?logo=rust)](https://www.rust-lang.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS-lightgrey)](#-platform-support)

---

## 💡 About Somul

**Somul** (**So**und **Mul**tiplexer) is a modern, privacy-first desktop application designed to give you total control over your computer's audio. It ships on macOS first; Windows and Linux are the next targets, and the codebase is structured around a platform-agnostic `AudioBackend` trait so they slot in without touching the UI.

Contributing? Start with [CONTRIBUTING.md](CONTRIBUTING.md) — it covers the code documentation
rules and the checks a pull request has to pass.

---

## ⬇️ Install

Requires **macOS 14.4 or newer**. Download the `.dmg` from the
[latest release](https://github.com/didik-maulana/somul/releases/latest), open it, and drag Somul
to Applications.

Then run this once:

```sh
xattr -dr com.apple.quarantine /Applications/Somul.app
```

**Somul is not notarized yet, and without that command macOS will refuse to open it.** Not "warn
about" — refuse: the app will not launch at all. Notarization needs a paid Apple Developer
account, which this project does not have yet. Anything you download from the internet carries a
quarantine flag; the command removes it for this one app.

If you would rather not run a command, the same thing can be done through the interface: try to
open Somul, then go to **System Settings → Privacy & Security**, find the message about Somul
near the bottom, and choose **Open Anyway**. On macOS 15 and newer, right-clicking the app and
choosing Open no longer works — that path was removed by Apple.

Somul is open source. If you would rather not trust a binary you cannot verify, build your own:
`npm ci && npm run tauri build`. A build you signed yourself needs no quarantine removal, and the
audio permission then stays granted across rebuilds — see
[`scripts/create-dev-signing-identity.sh`](scripts/create-dev-signing-identity.sh).

### While unsigned, expect this

- **The audio-capture permission resets on every update.** macOS attaches that permission to the
  app's signature, and an unsigned build's signature changes with every release. Somul will ask
  again and offer a relaunch when it does.
- **Updates themselves still work.** Somul checks for them at launch and installs them on your
  word; that signature is Somul's own and has nothing to do with Apple's.

---

## ✨ Key Features

- 🎛 **Per-App Volume Sliders**: Adjust volume levels for individual applications (Spotify, Chrome, Zoom, Games, Discord) independently.
- 🔀 **Per-App Audio Routing** *(Planned v1.1)*: Route specific apps to different output devices (e.g., Zoom to Headset, Spotify to Speakers).
- 📌 **System Tray First Interface**: Sleek, instant pop-up UI positioned right at your taskbar / menu bar.
- 📊 **Realtime Peak Meters**: Live visual audio meters showing real-time audio intensity per process.
- ⌨️ **Global Hotkey Shortcuts**: Toggle the mixer panel anywhere instantly (`Ctrl+Shift+V` / `Cmd+Shift+V`).
- 🔒 **100% Local & Private**: No tracking, no telemetry, zero cloud dependency.

---

## 🖥 Platform Support

Per-app audio control is not equally available on every OS. Somul degrades honestly rather than showing controls that do nothing.

**The first release is macOS only.** Windows and Linux are deliberately switched off until their
audio adapters exist: CI builds macOS alone, the bundler emits `.app` and `.dmg` alone, and
`platform_backend` in `src-tauri/src/lib.rs` fails a Windows or Linux build by name rather than
falling back to a mock. A binary whose sliders move nothing is worse than no binary.

| Platform | Per-App Volume / Mute / Meter | Status |
| :--- | :---: | :--- |
| **macOS** 14.4+ | ✅ | Shipping — Core Audio process taps, gated on audio-capture consent |
| **macOS** ≤ 14.3 | ⚠️ | Process tap API unavailable; master volume and metering only |
| **Windows** 10 1803+ | 🚧 | Next — needs an `AudioBackend` over WASAPI `ISimpleAudioVolume` |
| **Linux** (PipeWire / PulseAudio) | 🚧 | Next — also the only platform that can do native per-app routing |

Core Audio has no equivalent of Windows' `ISimpleAudioVolume`, so per-app control on macOS runs
through process taps — the approach used by [SonicFlow](https://github.com/altuzar/sonicflow) and
[FineTune](https://github.com/ronitsingh10/FineTune). Taps put the app inside the realtime render
path and require a stable code-signing identity, which is what made macOS the hard platform to
land first and the sensible one to prove the design on.

### Audio-recording permission

Per-app volume runs on Core Audio process taps, and a tap is audio capture: macOS gates it behind
the audio-recording TCC permission. An **unauthorized tap does not fail**. It is created, it
reports channels, and it delivers digital silence, while still muting the app it captured. Somul
therefore starts every tap in passthrough and only takes an app over once it has actually heard
it, so a missing permission costs per-app control rather than the audio itself.

Granting the permission needs a stable code-signing identity. An ad-hoc signed build (what
`cargo build` and an unconfigured `tauri build` produce) changes its code hash on every rebuild,
so TCC cannot keep a grant attached to it. Build with a real identity:

```sh
APPLE_SIGNING_IDENTITY="Apple Development: you@example.com (TEAMID)" npm run tauri build
```

Then allow Somul under System Settings, Privacy and Security, Audio Recording. Until that is in
place the panel lists every app holding an open output stream, playing or not, because without
capture there is no way to tell the two apart.

Re-arming a platform means three edits: add its runner back to the CI matrix (with the Linux
system-dependency step alongside it), widen `bundle.targets` in `src-tauri/tauri.conf.json`, and
replace its `compile_error!` in `src-tauri/src/lib.rs` with a real adapter.

---

## 🧪 Testing

```sh
npm run verify        # typecheck, lint, vitest, clippy, cargo test
npm test              # frontend only
```

### Testing the updater

Somul ships outside the App Store, so the in-app updater is the only thing that ever moves a user
off the build they installed. It has three test levels, cheapest first.

**1. Automated.** Covered by `npm run verify` — the check-at-launch, the banner, the settings row,
and the payload shape.

**2. The UI, without a release.** An environment variable makes the app announce a version:

```sh
SOMUL_FAKE_UPDATE=9.9.9 npm run tauri dev    # banner, "What's new", and the Install row
SOMUL_FAKE_UPDATE=1.0.0 npm run tauri dev    # the up-to-date branch
```

Debug builds only, and it stands in for the *check* alone: pressing Install afterwards fails,
because there is no release behind it. Everything up to that point is real — the banner, the
release-notes disclosure, the settings row, and the check that runs at launch.

**3. The real download, install, and restart.** The updater refuses any artifact that is not
signed by the key compiled into the app, so this needs its own key and its own feed. One script
does all of it:

```sh
./scripts/serve-test-update.sh --install   # build the current version, put it in /Applications
# bump `version` in src-tauri/tauri.conf.json and src-tauri/Cargo.toml
./scripts/serve-test-update.sh --slow      # build the newer one, publish it, serve it slowly
```

Then launch the installed copy: the notice appears in the panel, "What's new" opens the release
notes in their own window, Update downloads in the background behind a progress bar, and the
notice then offers **Restart now** or **Later** — the new build only takes over when you say so.

The changelog is deliberately not in the panel. The panel dismisses itself whenever focus moves
elsewhere, so notes read there vanish on the first click into another application. Rust owns the
update's phase and announces it, which is what keeps the two windows agreeing about what has
already been installed.

**The banner belongs to the installed build, not to this checkout.** Testing a change to the
update UI therefore takes two builds: install one that *contains* the change, then publish
something newer still for it to find.

`--slow` throttles the feed to 512 kB/s (`--slow=128` for slower). Unthrottled, a local server
hands over the whole bundle in under a second and the progress bar is gone before it can be read.

The script writes its endpoint and public key into a generated override config rather than
touching `tauri.conf.json`, so a test build can never be confused with a real one — delete
`src-tauri/tauri.updater-test.conf.json` when you are done.

It bundles the `.app` alone, never the DMG: the updater ships the `.app.tar.gz`, and `bundle_dmg.sh`
fails whenever an earlier run left a volume mounted under `/Volumes` — a way for the test to fail at
something it does not use. `--no-serve` publishes without serving; `--serve-only` serves what is
already published. If the run stops on a key password, the signing key predates the password the
script has: delete it, or export `SOMUL_TEST_KEY_PASSWORD` with the right one.

---

## 📦 Releasing

`.github/workflows/release.yml` runs on a `v*` tag. It refuses to build unless the tag, the
`version` in `src-tauri/tauri.conf.json`, and the one in `src-tauri/Cargo.toml` all agree — the
updater compares the running build against the manifest, so a release published under one number
while announcing another either re-offers an update that is already applied or hides one that is
not.

```sh
# 1. set the version in src-tauri/tauri.conf.json and src-tauri/Cargo.toml
# 2. commit it
git tag v1.0.0 && git push origin v1.0.0
```

The workflow builds a universal binary, signs it with the Developer ID identity, notarizes and
staples it, then publishes a **draft** release carrying the `.dmg`, the `.app.tar.gz`, its
signature, and `latest.json`. It is a draft on purpose: the release body becomes the "What's new"
the panel shows, so it gets read before anyone is offered the update. **Nothing reaches existing
installs until the draft is published** — `releases/latest/download/latest.json` only resolves for
a published release.

### The signing key, and why it is not in CI

Releases are built and signed on the maintainer's machine. The updater's private key is what
stands between a user and an update that is not from us — whoever holds it can sign a release
every installed copy accepts without asking — and putting it in repository secrets makes it
reachable by anyone who can write a workflow here. The workflow below exists for the day that
trade changes; it runs only when asked, and refuses to build without the key rather than shipping
an unsigned update quietly.

The **public** half is in `src-tauri/tauri.conf.json` and is compiled into every build:

```
minisign public key: 333AAEBC95206741
```

That identifier is worth knowing. It is what a release is signed against, so if it ever changes
between releases without a note explaining why, something is wrong — either the key was rotated
deliberately, or a release is not coming from where you think. Anyone can check a downloaded
`.app.tar.gz` against it with [minisign](https://jedisct1.github.io/minisign/) and the `.sig`
published beside it.

### Repository secrets

| Secret | What it is |
| :--- | :--- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the updater signing key. Its public half is committed in `tauri.conf.json`; an artifact signed by any other key is refused by every installed copy. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | That key's password. |
| `APPLE_CERTIFICATE` | Developer ID Application certificate, exported as `.p12` and base64-encoded. |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` export password. |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)`. |
| `APPLE_ID` | Apple ID used for notarization. |
| `APPLE_PASSWORD` | An **app-specific** password for that Apple ID, never the account password. |
| `APPLE_TEAM_ID` | The 10-character team identifier. |

The Developer ID identity is doing a second job beyond Gatekeeper: macOS attaches the
audio-capture grant to the signature, so changing identity between releases asks every user for
the permission again.

---

## 🛠 Tech Stack & Architecture

- **Backend**: Tauri v2 (Rust) behind a platform-agnostic `AudioBackend` trait — Core Audio today, WASAPI and PipeWire next
- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4, **shadcn/ui** (Radix UI), Lucide Icons
- **State Management**: Zustand

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

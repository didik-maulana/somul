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

## 🛠 Tech Stack & Architecture

- **Backend**: Tauri v2 (Rust) behind a platform-agnostic `AudioBackend` trait — Core Audio today, WASAPI and PipeWire next
- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4, **shadcn/ui** (Radix UI), Lucide Icons
- **State Management**: Zustand

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

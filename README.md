# 🔊 SOMUL (Sound Multiplexer)

> **Ultra-lightweight, cross-platform per-app volume mixer and audio router for macOS, Windows, and Linux.**

[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%20v2-blue?logo=tauri)](https://tauri.app)
[![Powered by Rust](https://img.shields.io/badge/Powered%20by-Rust-orange?logo=rust)](https://www.rust-lang.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#)

---

## 💡 About SOMUL

**SOMUL** (**So**und **Mul**tiplexer) is a modern, privacy-first, cross-platform desktop application designed to give you total control over your computer's audio.

Documentation map:

| Document | Owns |
| :--- | :--- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Platform limits, IPC contract, data model, coding standards |
| [DESIGN.md](DESIGN.md) | Design tokens, component anatomy, motion, accessibility |
| [GOAL.md](GOAL.md) | Build plan, task catalog, and agent execution protocol |

---

## ✨ Key Features

- 🎛 **Per-App Volume Sliders**: Adjust volume levels for individual applications (Spotify, Chrome, Zoom, Games, Discord) independently. *(Windows & Linux in v1 — see platform support below.)*
- 🔀 **Per-App Audio Routing** *(Planned v1.1)*: Route specific apps to different output devices (e.g., Zoom to Headset, Spotify to Speakers).
- 📌 **System Tray First Interface**: Sleek, instant pop-up UI positioned right at your taskbar / menu bar.
- 📊 **Realtime Peak Meters**: Live visual audio meters showing real-time audio intensity per process.
- ⌨️ **Global Hotkey Shortcuts**: Toggle the mixer panel anywhere instantly (`Ctrl+Shift+V` / `Cmd+Shift+V`).
- 🔒 **100% Local & Private**: No tracking, no telemetry, zero cloud dependency.

---

## 🖥 Platform Support

Per-app audio control is not equally available on every OS. SOMUL degrades honestly rather than showing controls that do nothing.

| Platform | Per-App Volume / Mute / Meter | Notes |
| :--- | :---: | :--- |
| **Windows** 10 1803+ | ✅ v1 | Full WASAPI support — reference platform |
| **Linux** (PipeWire / PulseAudio) | ✅ v1 | Full support; also the only platform with native per-app routing |
| **macOS** 14.4+ | ⚠️ v1.2 | Core Audio process taps + audio-capture consent |
| **macOS** ≤ 14.3 | ❌ | Process tap API unavailable; master volume and metering only |

macOS ships master volume and metering in v1, with per-app control landing in v1.2 via Core Audio process taps — the same approach used by [SonicFlow](https://github.com/altuzar/sonicflow) and [FineTune](https://github.com/ronitsingh10/FineTune). See [ARCHITECTURE.md §2.2](ARCHITECTURE.md) for the mechanism and its constraints.

---

## 🛠 Tech Stack & Architecture

- **Backend**: Tauri v2 (Rust) + OS Native Audio APIs (WASAPI, CoreAudio, PipeWire)
- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4, **shadcn/ui** (Radix UI), Lucide Icons
- **State Management**: Zustand

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

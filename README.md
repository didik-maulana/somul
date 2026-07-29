# 🔊 SOMUL (Sound Multiplexer)

> **Ultra-lightweight, cross-platform per-app volume mixer and audio router for macOS, Windows, and Linux.**

[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%20v2-blue?logo=tauri)](https://tauri.app)
[![Powered by Rust](https://img.shields.io/badge/Powered%20by-Rust-orange?logo=rust)](https://www.rust-lang.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#)

---

## 💡 About SOMUL

**SOMUL** (**So**und **Mul**tiplexer) is a modern, privacy-first, cross-platform desktop application designed to give you total control over your computer's audio.

For detailed architecture, design system specifications, and coding standards, check out [ARCHITECTURE.md](ARCHITECTURE.md).

---

## ✨ Key Features

- 🎛 **Per-App Volume Sliders**: Adjust volume levels for individual applications (Spotify, Chrome, Zoom, Games, Discord) independently.
- 🔀 **Per-App Audio Routing** *(Planned v1.1)*: Route specific apps to different output devices (e.g., Zoom to Headset, Spotify to Speakers).
- 📌 **System Tray First Interface**: Sleek, instant pop-up UI positioned right at your taskbar / menu bar.
- 📊 **Realtime Peak Meters**: Live visual audio meters showing real-time audio intensity per process.
- ⌨️ **Global Hotkey Shortcuts**: Toggle the mixer panel anywhere instantly (`Ctrl+Shift+V` / `Cmd+Shift+V`).
- 🔒 **100% Local & Private**: No tracking, no telemetry, zero cloud dependency.

---

## 🛠 Tech Stack & Architecture

- **Backend**: Tauri v2 (Rust) + OS Native Audio APIs (WASAPI, CoreAudio, PipeWire)
- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4, **shadcn/ui** (Radix UI), Lucide Icons
- **State Management**: Zustand

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

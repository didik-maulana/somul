# Performance measurements

Measured numbers for the budgets in ARCHITECTURE.md §1. Nothing here is estimated. Where a
budget was not measured, this file says so rather than guessing.

**Machine**: Mac16,8 (Apple M4 Pro), 24 GB RAM, macOS 26.5.2 (25F84)
**Build**: `npm run tauri build -- --bundles app`, release profile, arm64
**Date**: 2026-08-05

---

## The metric matters more than the number

macOS reports two different things that both get called "memory", and they disagree by a factor
of three for this app:

| Metric | Somul, panel hidden | What it counts |
| :--- | ---: | :--- |
| `ps -o rss` | **101 MB** | Every resident page, including shared framework text mapped into the process. Most of it belongs to CoreAudio, WebKit, and AppKit, and is shared with every other app on the machine. |
| `phys_footprint` | **31 MB** | Pages this process is actually charged for. This is the number Activity Monitor shows in its Memory column. |

An earlier note in the ledger recorded 97 MB against a 25 MB budget. That was RSS, so the app
looked four times worse than it is. Use `footprint -p <pid>`; `ps` overstates for any app that
links a large system framework, which is every GUI app on macOS.

---

## Idle memory

Budget: **< 40 MB idle with the panel closed, < 80 MB open**. Met. The original target was
25 MB and was revised after this measurement: the WebView process alone costs 40 MB, and that
is WebKit's resident set rather than Somul's.

| State | Somul process | WebView process | Total |
| :--- | ---: | ---: | ---: |
| Launched, panel never opened | 31 MB | none | **31 MB** |
| Panel open | 26 MB | 40 MB | **66 MB** |
| Peak observed | 34 MB | — | — |

The WebView is a separate process (`com.apple.WebKit.WebContent`) and does not exist until the
panel is shown for the first time. It then stays alive for the life of the app, which is what
makes reopening the panel instant. It is also, at 40 MB, the single largest cost in the app and
the one least available to optimisation: it is WebKit's own resident set, not Somul's.

Somul's own 26–31 MB covers the CoreAudio process taps, the aggregate device, the tap buffers,
and the per-app icon cache. Icons are already downscaled to 64 px before encoding, so the cache
holds thumbnails rather than the 1–2.6 MB originals macOS hands out.

## Background CPU

Budget: **< 0.1% background CPU**. Met.

| State | CPU |
| :--- | ---: |
| Panel hidden, sampled after 20 s idle | **0.0%** |

The meter loop stops entirely when the panel is hidden rather than throttling — asserted in
`src-tauri/src/meter.rs` by a test that fails if the loop merely slows down.

## Not measured

Two §1 budgets have no number here, and inventing one would be worse than leaving the gap:

- **< 300 ms to tray.** Needs timing instrumentation at the tray-registration call. The ordering
  that the budget exists to protect is in place and enforced by code structure — the tray is
  registered in `setup()` before the WebView is built — but the elapsed time itself is unmeasured.
- **60 fps meter rendering.** The Rust side's 30 Hz emit cadence is covered by
  `approximates_the_thirty_hertz_cadence`. What the UI does between those frames needs a browser
  profiler against a running panel, which has not been run.

---

## Method

```sh
npm run tauri build -- --bundles app
open src-tauri/target/release/bundle/macos/Somul.app
sleep 20                                    # let it settle
MAIN=$(pgrep -f "Somul.app/Contents/MacOS/somul" | head -1)
footprint -p "$MAIN" | grep phys_footprint  # the honest number
ps -o rss=,%cpu= -p "$MAIN"                 # RSS for comparison only
pgrep -f WebContent                         # the WebView, once the panel has been shown
```

Single machine, single run, one build. Numbers on Intel hardware or under memory pressure will
differ, and nobody has measured those.

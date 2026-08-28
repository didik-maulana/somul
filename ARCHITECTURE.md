# Somul Architecture

How Somul is built, why it is shaped the way it is, and the contracts that hold it together. This
document describes the code as it exists today. Appearance (colour, type, spacing, motion) is
not covered here; the design tokens live in `src/styles/index.css` and their contrast thresholds
are checked by `scripts/audit-contrast.mjs`.

## 1. Overview

Somul is a menu bar app for macOS that gives every app playing audio its own volume slider and
mute button, alongside the system master volume and output device. It is built on Tauri v2: a
Rust core owns everything that touches the operating system, and a React panel renders it.

The single hard problem is that macOS has no API to set another process's volume. Somul solves it
by standing in the audio path: each app is captured with a Core Audio process tap, mixed at the
user's chosen gain, and re-rendered to the output device. Section 3 covers how, and what that
costs.

Somul ships for macOS 14.4 and newer only. The audio layer is designed as a trait with one adapter
per platform, and Windows and Linux adapters are planned, but a build for those targets fails by
name rather than shipping controls that do nothing. See section 12.

### Budgets

These are budgets, not aspirations. A change that breaks one is a regression. Measured numbers are
in [docs/PERF.md](docs/PERF.md).

| Budget | Mechanism | Status |
| :--- | :--- | :--- |
| Under 40 MB idle with the panel closed, under 80 MB open (`phys_footprint`, not RSS) | One WebView window, created hidden at boot. The WebView process does not exist until the panel is first shown. | Measured 31 MB and 66 MB |
| Under 0.1% background CPU | The meter loop is stopped, not throttled, while the panel is hidden. Session discovery is notification-driven. | Measured 0.0% |
| Under 300 ms to an interactive tray | The tray is registered before the WebView is built. | Ordering enforced, time unmeasured |
| Smooth meter rendering | Rust emits one batched peak event per tick at 30 Hz. | Cadence tested; the panel does not yet subscribe to peaks |

One carve-out: while any app is tapped, Somul is part of the render path and the CPU budget does
not apply. Expect roughly 1 to 2% CPU while tapped audio plays, and memory that scales with the
number of tapped apps.

## 2. System shape

```
┌──────────────────────────────────────────────────────────────┐
│                       Panel (WebView)                        │
│           React 19 · Tailwind v4 · shadcn/ui · Zustand       │
└───────────▲──────────────────────────────────┬───────────────┘
            │                                  │
   events (push)                        invoke() (request/response)
   audio://sessions-changed             get_audio_sessions
   audio://master-changed               set_session_volume
   audio://peaks (30 Hz)                set_master_volume …
            │                                  │
┌───────────┴──────────────────────────────────▼───────────────┐
│                        Rust core (Tauri v2)                  │
│   commands/  ·  meter.rs  ·  tray.rs  ·  shortcut.rs         │
│   settings.rs  ·  memory.rs (RememberingBackend)             │
└──────────────────────────┬───────────────────────────────────┘
                           │  trait AudioBackend
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  audio/macos  (Core Audio)                   │
│   process.rs discovery · tap.rs · engine.rs mixer · watch.rs │
└──────────────────────────────────────────────────────────────┘
```

Two channels, never mixed. Commands are request/response and user-initiated. Events are a one-way
push stream from the core to the panel. Telemetry never rides the command channel.

The backend is one shared instance. The command layer and the meter loop drive the same
`Arc<dyn AudioBackend>`; two instances would mean two OS enumerators whose views of the session
list drift apart.

## 3. Per-app volume on macOS

Core Audio has nothing like Windows' `ISimpleAudioVolume`. Per-app volume is therefore not a
setter. It is capture, attenuate, re-render.

### 3.1 The mechanism

1. **Discover.** `process.rs` reads `kAudioHardwarePropertyProcessObjectList` and keeps only
   processes that are currently running output and that belong to an app the user opened. System
   daemons such as `audiomxd` and `CoreSpeech` are dropped.
2. **Collapse helpers into apps.** A browser plays YouTube through a GPU helper and a media helper,
   not through its main process. Every audio process is walked up to the application that owns
   it, through the parent PID for Chromium-style helpers and through `responsibility_get_pid_responsible_for_pid`
   for XPC services such as `com.apple.WebKit.GPU`. Processes sharing an owner become one session,
   which is the only reading under which a per-app slider means anything.
3. **Tap.** `tap.rs` creates one `CATapDescription` per app covering all of its processes as a
   stereo mixdown, and passes it to `AudioHardwareCreateProcessTap`. The tap is created in
   passthrough mode first: the app keeps playing through the hardware and Somul only listens.
4. **Aggregate.** `engine.rs` builds a private aggregate device with the real output device as its
   main sub-device and every tap attached as a sub-tap. A single IO proc on that device reads each
   tap's channels at a fixed stereo stride, multiplies by the app's gain, applies mute, records
   the pre-gain peak, and writes the sum to the output.
5. **Promote.** Once a tap has carried eight consecutive render cycles above the noise floor, the
   app is known to be audible and its tap is recreated as `CATapMuted`. From that moment the app
   is silent at the hardware and heard only through Somul's mix, which is what makes the gain
   effective. Taps that never hear anything stay in passthrough and never take an app's audio
   away.

The render callback runs on a realtime thread. It allocates nothing, takes no locks, and reads
gain, mute, and peak through atomics. A stall there is an audible dropout.

### 3.2 Permission

Process taps are audio capture, gated by the TCC service behind `NSAudioCaptureUsageDescription`
in `Info.plist` and the `com.apple.security.device.audio-input` entitlement. macOS surfaces the
prompt as Audio Recording (or Screen & System Audio Recording on newer releases). No microphone
permission is requested.

An unauthorised tap does not fail. It is created successfully, reports channels, and delivers
silence. That makes denial indistinguishable from a quiet Mac from inside the audio path, and
`capture.rs` exists to stop the engine reading silence as a refusal. What the engine can know:

* macOS lists which processes are producing output right now, so an app in the list is playing.
* A tap that hears nothing while its app is playing is a tap macOS is feeding silence.
* Once capture has worked on this machine, a marker file under
  `~/Library/Application Support/com.somul.app/capture-proven` records it, because that ambiguity
  is gone for good.

While capture is unproven the engine rebuilds its taps every three seconds to re-ask macOS, and
stops after two silent retries. macOS answers the capture question once per process, so a grant
made after launch is only seen by a fresh process. At that point the panel offers a relaunch.

The permission is attached to the code signature. An ad-hoc signed build changes identity on
every rebuild, and the grant stops matching. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
local signing identity that solves this in development.

### 3.3 Failure modes

Because tapped apps are muted at the hardware, a Somul crash silences every tapped app until the
tap is destroyed. The design answers this in three places:

* `ProcessTap` destroys its tap on `Drop`. A leaked tap is the one failure that leaves an app
  permanently silent with no UI to unsilence it, so teardown is not a code path that has to be
  reached.
* If the engine fails to start, every tap is dropped and the apps return to the hardware at their
  own level. The fallback is "no mixing", never "no audio".
* A muted tap set that goes deaf (permission revoked mid-session) is demoted back to passthrough
  and the capture marker is forgotten.

### 3.4 Capabilities are earned at runtime

`MacOsAudioBackend::capabilities()` reports what the engine actually managed, not what the
platform theoretically supports. Below macOS 14.2 there is no tap API. With the permission
withheld there is no mixing. In both cases the adapter reports master-only with an
`unsupportedReason` the panel renders verbatim in place of the session list. The panel never
shows a row of dead sliders.

Capabilities are pushed to the panel through `audio://capabilities-changed` rather than read once,
because whether an app has been heard yet is a fact about elapsed time.

## 4. The audio contract

`src-tauri/src/audio/mod.rs` defines one trait every platform adapter implements:

```rust
pub trait AudioBackend: Send + Sync {
    fn capabilities(&self) -> PlatformCapabilities;

    fn list_sessions(&self) -> Result<Vec<AudioSession>, AudioError>;
    fn set_session_volume(&self, id: &SessionId, volume: f32) -> Result<(), AudioError>;
    fn set_session_mute(&self, id: &SessionId, is_muted: bool) -> Result<(), AudioError>;

    fn master(&self) -> Result<MasterState, AudioError>;
    fn set_master_volume(&self, volume: f32) -> Result<(), AudioError>;
    fn set_master_mute(&self, is_muted: bool) -> Result<(), AudioError>;

    fn list_output_devices(&self) -> Result<Vec<AudioDevice>, AudioError>;
    fn set_default_output_device(&self, device: &DeviceId) -> Result<(), AudioError>;
    fn set_session_output_device(&self, id: &SessionId, device: &DeviceId) -> Result<(), AudioError>;

    fn read_peaks(&self) -> Result<Vec<SessionPeak>, AudioError>;

    fn sessions_may_have_changed(&self) -> Option<bool> { None }
}
```

Rules the trait enforces:

* An unsupported operation returns `AudioError::Unsupported`, never `Ok(())`. A silent no-op
  surfaces to the user as a control that appears to work and does nothing.
* Volume and peak are linear scalars from 0.0 to 1.0 on the wire. Adapters clamp at the boundary
  and map NaN to silence.
* `sessions_may_have_changed` lets a backend that gets OS notifications tell the meter loop when
  enumeration is worth doing. `None` means "I do not know, poll me"; `Some(false)` means "nothing
  changed". Conflating the two would stop a polling backend from ever refreshing.

### 4.1 Layers around the adapter

**`RememberingBackend`** (`memory.rs`) wraps the platform adapter and remembers each app's last
volume and mute state, keyed by `processName`. It restores the remembered level during
enumeration, so the panel never shows a row at full volume that then jumps, and it observes every
write regardless of who made it. Memory is persisted into the settings store.

**`MockAudioBackend`** (`audio/mock.rs`) is a full in-memory adapter with seeded sessions and
synthetic peaks. It is a release requirement, not a convenience: it is how the command layer and
the meter loop are tested without audio hardware, and how CI runs at all.

**The contract suite** (`audio/contract.rs`) is written once and run unchanged against every
adapter through the `audio_backend_contract!` macro. It checks capability self-consistency,
session identity rules, clamping, round trips, and that writes to a dead session report
`SessionNotFound`. An adapter that needs a relaxed variant of a check has found a contract
disagreement, not a test to weaken.

### 4.2 Session identity

`SessionId` is opaque and adapter-generated. It is never a PID: one process routinely owns several
sessions and the OS recycles PIDs, so a PID-keyed write can land on an unrelated process. The
`SessionId` constructor rejects any all-digit identifier, and the same guard runs on
deserialisation at the IPC boundary and in `parseSessionId` on the TypeScript side. Adapters
namespace their identifiers instead. The `pid` field on a session is display metadata only.

## 5. Runtime

### 5.1 Startup

Ordered to hit the tray budget:

1. `tauri-plugin-single-instance` guard. A second launch focuses the existing panel and exits.
2. Activation policy is set to Accessory. Somul has no Dock icon, and an Accessory app can take
   key focus over whatever is frontmost, which a Regular app cannot.
3. The audio backend, memory decorator, meter gate, and meter loop are created and registered as
   managed state. The loop starts blocked, because the panel is hidden.
4. The tray icon and menu are registered. The tray is interactive from this point. If tray
   registration fails, the app falls back to a normal decorated window rather than exiting.
5. The panel window is built hidden, undecorated, always on top, not resizable, at 360 by 520
   logical pixels with a 20 px corner radius applied to the native window so the vibrancy layer
   matches the CSS surface.
6. Settings are loaded and the global hotkey is registered. A hotkey another app owns is a
   degraded state, not a startup failure; the settings view shows a warning.

### 5.2 The meter loop

`meter.rs` is the only hot path in the application. It runs on its own thread at 30 Hz and is
gated on panel visibility through a condvar: while the panel is hidden the thread blocks, making
zero backend calls and zero wakeups.

Each tick while visible:

* `read_peaks()` and one `audio://peaks` emit covering every session. Never one emit per session.
* Every 6th tick (roughly 5 Hz), the master state is re-read and `audio://master-changed` is
  emitted if volume, mute, or device changed. The OS volume can move from the keyboard or System
  Settings, and asking is the only way to notice.
* Every 30th tick (once a second), or immediately when the backend reports a change through
  `sessions_may_have_changed`, the session list is re-enumerated and `audio://sessions-changed`
  is emitted if identity, level, mute, or state differs. Peaks are excluded from the comparison
  because they change every frame by design.
* Capability changes are emitted as `audio://capabilities-changed`.

On macOS, `watch.rs` registers Core Audio property listeners on the process list and on each
process's running-output flag, so an app that starts playing appears within a tick rather than on
the next poll. Session enumeration is also where the tap set is synced, which is why writes never
enumerate: a drag debounced to 50 ms would otherwise walk the process tree twenty times a second,
and a rebuild during a drag is audible.

When the panel opens, `audio://master-resync` carries the current system state once. It is a
separate event from `master-changed` because the UI applies it instantly rather than easing into
it; easing would animate the slider from wherever it was when the panel closed, which looks like
Somul changing the volume rather than reporting it.

### 5.3 The panel window

* Toggled from the tray icon, the tray menu, or the global hotkey (`CmdOrCtrl+Shift+V` by
  default, rebindable in settings).
* Positioned centred under the tray icon and clamped to the monitor that contains it.
* Dismissed when focus leaves it or when the user switches desktop. The dismiss is
  a 140 ms alpha fade on the native window followed by `set_panel_visibility(false)`, which stops
  the meter loop. A 300 ms grace period after showing prevents the focus change caused by showing
  from dismissing it immediately.
* Vibrancy comes from the macOS compositor (`NSVisualEffectMaterial::Popover`), because CSS
  `backdrop-filter` can only blur content inside the WebView, never the desktop behind it. The
  panel must remain legible on an opaque surface; translucency is never load-bearing for contrast.
* Appearance (dark, light, or system) is applied to the native window as well as to the CSS, or
  the blur material stays on the wrong theme.

A second, ordinary window shows release notes. It is decorated, resizable, and does not dismiss on
focus loss. Both windows load the same bundle; `main.tsx` routes on `?view=update`.

## 6. IPC contract

Every command resolves to `Result<T, AudioError>`. A rejected promise carries a structured
`AudioError`, never a bare string. All Rust structs use `#[serde(rename_all = "camelCase")]` and
`src/types/ipc.ts` mirrors them field for field. Rust is the source of truth.

The full command list is declared once in the `somul_command_handlers!` macro in
`commands/mod.rs`. `lib.rs` and the handler tests both expand it, so a command that reaches
production unregistered cannot pass the suite.

### 6.1 Commands

| Command | Input | Returns |
| :--- | :--- | :--- |
| `get_platform_capabilities` | | `PlatformCapabilities` |
| `get_audio_sessions` | | `AudioSession[]` |
| `set_session_volume` | `{ sessionId, volume }` | |
| `set_session_mute` | `{ sessionId, isMuted }` | |
| `get_master_state` | | `MasterState` |
| `set_master_volume` | `{ volume }` | |
| `set_master_mute` | `{ isMuted }` | |
| `list_output_devices` | | `AudioDevice[]` |
| `set_default_output_device` | `{ deviceId }` | |
| `set_session_output_device` | `{ sessionId, deviceId }` | Rejected with `unsupported` on macOS |
| `set_panel_visibility` | `{ isVisible }` | Starts and stops the meter loop |
| `set_panel_appearance` | `{ isDark }` | `null` hands appearance back to macOS |
| `open_audio_permission_settings` | | Opens the Privacy & Security pane |
| `relaunch_app` | | Restarts into a new process |
| `get_settings` | | `AppSettings` |
| `update_settings` | `{ settings }` | `SettingsUpdate`, what was actually applied |
| `set_hotkey_capture` | `{ isCapturing }` | Frees the hotkey while the user records a new one |
| `get_update_state` | | `UpdateSnapshot` |
| `check_for_update` | | `UpdateSnapshot` |
| `install_update` | | Resolves when the new build is on disk |
| `open_update_window` | | |

`set_panel_visibility` is not cosmetic. It is the CPU budget's enforcement point, and a handler
test asserts it is the only command that touches the meter gate.

`update_settings` returns the settings that were applied, which can differ from what was sent: a
hotkey the OS refuses is rolled back to the previous one, and the UI must render the returned
value rather than its own optimistic copy.

### 6.2 Events

| Event | Payload | When |
| :--- | :--- | :--- |
| `audio://peaks` | `SessionPeak[]`, one batch for all sessions | 30 Hz while the panel is visible |
| `audio://sessions-changed` | `AudioSession[]` | When the list, a level, a mute, or a state changes |
| `audio://master-changed` | `MasterState` | When the system volume, mute, or device changes |
| `audio://master-resync` | `MasterState` | Once, when the panel opens |
| `audio://capabilities-changed` | `PlatformCapabilities` | When the engine gains or loses per-app control |
| `panel://shown` | | Every time the tray puts the panel on screen |
| `update://changed` | `UpdateSnapshot` | When the update reaches a new resting state |
| `update://progress` | `UpdateProgress` | Roughly once per percent during download |

`audio://device-changed` and `audio://backend-error` are declared on the frontend for contract
completeness but nothing emits them today.

### 6.3 Errors

```rust
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum AudioError {
    SessionNotFound(SessionId),
    DeviceNotFound(DeviceId),
    DeviceInvalidated,
    PermissionDenied(String),
    Unsupported(String),
    BackendFailure(String),
}
```

| Kind | Frontend response |
| :--- | :--- |
| `sessionNotFound` | Drop the row silently. The app closed mid-write; not an error state. |
| `deviceInvalidated` | Re-fetch devices and sessions, retry once, surface nothing unless the retry fails. |
| `permissionDenied` | Persistent notice with a button to the relevant System Settings pane. |
| `unsupported` | Should be unreachable, since capabilities are checked up front. Log it; it indicates a capability-gate bug. |
| `deviceNotFound`, `backendFailure` | Inline message on the affected row. |

`src/lib/ipc.ts` wraps every rejection in `AudioCommandError`, so callers only ever branch on
`kind`.

## 7. Data model

```ts
interface AudioSession {
  sessionId: SessionId;          // opaque, never a PID
  pid: number;                   // display and debugging only
  displayName: string;           // "Spotify"
  processName: string;           // bundle identifier on macOS; the memory key
  iconDataUri: string | null;    // 64 px PNG, downscaled from the app icon
  volume: number;                // linear 0.0 to 1.0
  isMuted: boolean;
  outputDeviceId: DeviceId | null;
  state: 'active' | 'inactive' | 'expired';
}

interface MasterState {
  deviceId: DeviceId;
  deviceName: string;
  volume: number;                // linear 0.0 to 1.0
  isMuted: boolean;
  isVolumeControllable: boolean; // false for devices that keep gain in hardware
}

interface PlatformCapabilities {
  hasPerAppVolume: boolean;
  hasPerAppMute: boolean;
  hasPerAppMeter: boolean;
  hasPerAppRouting: boolean;
  unsupportedReason: string | null;  // rendered verbatim in place of the session list
}
```

Volume and peak are linear scalars across the entire IPC surface. Percentages are a
presentation concern only, formatted in `src/lib/audio.ts` for display.

`isVolumeControllable` exists because aggregates, most HDMI outputs, and many USB DACs publish no
software volume. `volume` reads as unity there because nothing is attenuating, and a slider drawn
from that value would sit at 100% and refuse to move.

A session's `state` is `inactive` when the app is listed but Somul could not tap it, or its tap is
still in passthrough. The row is present but its slider carries no gain yet.

## 8. Frontend

### 8.1 Layout

```
src/
├── lib/ipc.ts             the only file that imports @tauri-apps/api (ESLint-enforced)
├── lib/audio.ts           scalar clamping and percent formatting
├── lib/accelerator.ts     hotkey parsing and display
├── lib/theme.ts           theme resolution, applied before first render
├── types/ipc.ts           mirror of the Rust payload types
├── stores/                audioStore, settingsStore (Zustand)
├── components/ui/         shadcn/ui primitives: no business logic, no IPC
├── components/common/     PanelShell, PanelHeader, PanelFooter, EmptyState
└── features/
    ├── master/            MasterVolumeCard, DeviceSelector, useMasterVolume, useOutputDevices
    ├── mixer/             MixerList, AppAudioRow, VolumeSlider, useAudioSessions, useVolumeCommit
    ├── settings/          SettingsView, HotkeyRecorder, ThemeSwitcher, useSettings
    └── update/            UpdateNotice, UpdateWindow, useUpdate
```

Components never call `invoke`. Every IPC round trip goes through a feature hook, which is what
lets `App.tsx` be composition only and the whole tree render under Vitest without a Tauri runtime.

### 8.2 State ownership

This is the one place where a naive implementation produces a visible bug: a live event stream
fighting the user's drag.

| State | Owner | Rule |
| :--- | :--- | :--- |
| Slider position during a drag | React local state | Optimistic and authoritative. Renders immediately, no round trip. |
| Volume commit | `useVolumeCommit` | Trailing debounce of 50 ms, plus a guaranteed flush on pointer up. |
| Session list | `audioStore` | Replaced wholesale on `audio://sessions-changed`, merged around dragging rows. |
| Master state | `audioStore` | Same merge rule, keyed on `isDraggingMaster`. |
| Peaks | Not in any store | They arrive at 30 Hz; a store would re-render every subscriber thirty times a second. The panel does not render them yet; when it does, they go to element refs in one `requestAnimationFrame` loop. |
| Settings | `settingsStore` | Persisted through the backend; the UI renders what `update_settings` returns. |

The reconciliation rule: while a session is being dragged, an incoming `sessions-changed` must
not overwrite that session's volume. The backend publishes the list every second, and its echo of
the previous value would otherwise land mid-drag and snap the thumb backwards. `audioStore` holds
a `draggingSessionIds` set and `mergeSessions` skips the volume of every session in it. Dragging
ends only once the commit has resolved, not when the pointer lifts, for the same reason.

### 8.3 Theming

The theme is resolved and applied in `main.tsx` before the first render. The panel opens over the
desktop, and a light frame flashing before the dark theme lands is very visible against a dark
wallpaper. The resolved theme is also sent to the native window through `set_panel_appearance`.

## 9. Persistence

`tauri-plugin-store` writes `settings.json` to the platform config directory.

```ts
interface AppSettings {
  schemaVersion: number;                       // currently 2
  hotkey: string;                              // "CmdOrCtrl+Shift+V"
  theme: 'dark' | 'light' | 'system';
  shouldLaunchAtLogin: boolean;
  routingPresets: Record<string, string>;      // processName -> deviceId, reserved
  volumeMemory: Record<string, number>;        // processName -> last volume
  muteMemory: Record<string, boolean>;         // processName -> last mute state
}
```

Memory is keyed by `processName`, not `sessionId`, because it must survive an app restart and a
session id does not. It is written by the audio path, not the settings view; `update_settings`
preserves whatever memory is on disk.

Migration edits the stored map in place and preserves unknown keys, so a user who downgrades and
upgrades again does not lose data written by the newer build.

Settings side effects (registering the hotkey, toggling launch at login) run before the store is
written. A change the OS refuses is never persisted as though it had worked.

## 10. Security

Somul loads no remote content, makes no network request except the signed update check, and
collects no telemetry.

* **Capabilities** (`src-tauri/capabilities/default.json`): `core:default`, `store:default`,
  `updater:default`, and the three `global-shortcut` permissions. No `shell:` or `fs:` permission.
  A feature that appears to need one is a design smell; route it through a purpose-built Rust
  command instead.
* **CSP**: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`.
  `img-src data:` is required for app icons; inline styles are required by Tailwind's runtime
  layer.
* **Fonts** are bundled. No CDN.
* **Updater** artifacts are signed with a minisign key whose public half is compiled into every
  build through `tauri.conf.json`. An artifact signed by anything else is refused. The private key
  lives on the maintainer's machine and never in CI. In a repository's secret store it would be
  reachable by anyone who can write a workflow there, and whoever holds it can sign a release
  every installed copy accepts.
* **App Sandbox** is off, because process taps are unreliable under it. Hardened Runtime stays on.
  This rules out the Mac App Store; distribution is direct download.

## 11. Testing

| Layer | Tool | What it covers |
| :--- | :--- | :--- |
| Backend unit | `cargo test` | Clamping, session diffing, settings migration, memory decorator, meter cadence and gating |
| Backend contract | `cargo test` with `audio_backend_contract!` | Every adapter, including the mock, runs the same suite |
| Command layer | `cargo test` with Tauri's `MockRuntime` | Commands invoked by name through the real IPC path, so a missing registration or a misnamed parameter fails |
| Frontend unit | Vitest | `lib/` math, store merge rules, debounce and flush |
| Frontend component | Vitest and Testing Library | Row states, the drag reconciliation rule, settings and update views |

A meter test asserts the loop stops entirely when the panel hides, and fails if it merely slows
down. The Core Audio adapter's own tests run against real hardware behind a mutex and restore
whatever state they touch.

`npm run verify` runs typecheck, ESLint, Vitest, Clippy with `-D warnings`, and `cargo test`. CI
runs it on `macos-latest`, on demand.

## 12. Build and distribution

`npm run tauri build` produces `Somul.app` and `Somul.dmg` for the host architecture. Releases are
universal (arm64 and x86_64), built and signed on the maintainer's machine, and published as a
GitHub release together with `latest.json`, which is what the updater endpoint in
`tauri.conf.json` points at. The release body becomes the "What's new" text the panel shows.

The version the updater compares against comes from `tauri.conf.json`, and it must agree with
`Cargo.toml` and the release tag. `.github/workflows/release.yml` checks this, and refuses to run
without the updater signing key rather than publishing an update no installed copy would accept.

Releases are ad-hoc signed, through `signingIdentity` in `tauri.conf.json`. Without it Tauri signs
nothing at all unless `APPLE_SIGNING_IDENTITY` is set, and an unsigned bundle gives TCC no stable
identity to attach the audio-capture grant to: every tap re-prompts, and allowing it never sticks.
The ad-hoc signature also carries the entitlements, which an unsigned bundle drops.

Current releases are not notarized. Users remove the quarantine flag once, and macOS forgets the
audio-capture grant on every update because the signature changes. A Developer ID signature and
notarization would fix both.

### Other platforms

The audio layer is one trait and one adapter per platform, and `PlatformCapabilities` exists so
the panel degrades honestly on platforms with less than full support. Windows (WASAPI) and Linux
(PipeWire with a PulseAudio fallback) adapters are planned but not started; they cannot be
developed or verified on the macOS host this project is built on. Until they exist,
`platform_backend()` in `lib.rs` fails a Windows or Linux build with a `compile_error!` naming
the missing adapter. A mock standing in for a real backend in a shipped binary would present
working controls that move nothing, which is the same dishonesty the trait forbids of an
unsupported operation.

## 13. Repository layout

```
somul/
├── src-tauri/
│   ├── src/
│   │   ├── audio/
│   │   │   ├── mod.rs          AudioBackend trait, shared types, SessionId guard
│   │   │   ├── error.rs        AudioError
│   │   │   ├── contract.rs     the adapter test suite
│   │   │   ├── mock.rs         MockAudioBackend
│   │   │   └── macos/
│   │   │       ├── mod.rs      MacOsAudioBackend: master volume, devices, capabilities
│   │   │       ├── process.rs  session discovery and helper-to-app collapsing
│   │   │       ├── tap.rs      ProcessTap
│   │   │       ├── engine.rs   aggregate device, render callback, capture probing
│   │   │       ├── capture.rs  what silence does and does not prove
│   │   │       ├── watch.rs    Core Audio change listeners
│   │   │       ├── icon.rs     app icons as data URIs
│   │   │       └── property.rs typed Core Audio property accessors
│   │   ├── commands/           IPC handlers; audio, panel, settings, update
│   │   ├── memory.rs           RememberingBackend
│   │   ├── meter.rs            the 30 Hz loop and its gate
│   │   ├── settings.rs         AppSettings, migration, store IO
│   │   ├── shortcut.rs         global hotkey
│   │   ├── tray.rs             tray icon, panel placement, show and dismiss
│   │   └── lib.rs              builder, plugin wiring, window construction
│   ├── capabilities/default.json
│   ├── entitlements.plist
│   ├── Info.plist              NSAudioCaptureUsageDescription
│   └── tauri.conf.json
├── src/                        React frontend (see section 8)
├── scripts/                    signing identity, state reset, updater test rig, contrast audit
├── website/                    somul.app (Next.js)
└── docs/PERF.md                measured budgets
```

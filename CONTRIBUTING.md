# Contributing to Somul

Thanks for your interest in Somul. This guide covers how to get a working build, how the code is
organised, what the checks expect, and what a pull request needs before it can be merged.

If you only want to use the app, [README.md](README.md) has the install steps.

## Before you start

Somul is a macOS app. Development needs:

* macOS 14.4 or newer
* Xcode Command Line Tools (`xcode-select --install`)
* Rust stable via `rustup`
* Node.js 20 or newer

```sh
git clone https://github.com/didik-maulana/somul.git
cd somul
npm ci
npm run tauri dev
```

`npm run tauri dev` starts Vite and the Tauri shell together with hot reload for the frontend.
Rust changes rebuild the backend and restart the app.

### Getting per-app volume to work in a dev build

Master volume works with no setup. Per-app volume runs on Core Audio process taps, and macOS ties
the audio-capture permission to the app's code signature. An unsigned or ad-hoc signed build gets a
new identity on every rebuild, so the grant you gave in System Settings stops matching and every
tap silently returns silence.

Create a stable local signing identity once, then build with it:

```sh
./scripts/create-dev-signing-identity.sh
APPLE_SIGNING_IDENTITY="Somul Dev" npm run build:local
```

The identity belongs to no Apple team and cannot be distributed. Its only job is to say "this is
the same app" across rebuilds. If taps never prompt for permission, check the signing tier before
debugging tap code: an unsigned build fails silently and looks identical to a logic bug.

`SOMUL_TAP_DIAGNOSTICS=1` prints what the tap engine is doing to stderr in any build. Debug builds
print it by default.

### Useful scripts

| Script | What it does |
| :--- | :--- |
| `npm run verify` | Typecheck, lint, Vitest, Clippy, and `cargo test`. The gate every PR must pass. |
| `npm run build:local` | `tauri build` with the updater artifacts turned off. Signing those needs the release key, which lives in CI and nowhere else, so a plain `tauri build` ends a full release compile complaining about a key no contributor has. The override is `src-tauri/tauri.local.conf.json`; the committed config keeps them on so a real release cannot ship unsigned. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run audit:contrast` | Checks the colour tokens in `src/styles/index.css` against WCAG contrast thresholds. |
| `scripts/reset-local-state.sh` | Wipes Somul's settings, memory, and TCC grant for a clean first-run test. |
| `scripts/serve-test-update.sh` | Serves a locally signed update feed so the updater can be exercised end to end. `SOMUL_FAKE_UPDATE=9.9.9 npm run tauri dev` is enough to see the banner without it, and in a debug build Install then walks a fake download to "Update installed" without touching disk, so the release-notes window's whole flow can be exercised. |

## How the code is organised

Read [ARCHITECTURE.md](ARCHITECTURE.md) before making a non-trivial change. The short version:

* `src-tauri/src/audio/` is the platform boundary. Everything that talks to Core Audio lives in
  `audio/macos/`, behind the `AudioBackend` trait in `audio/mod.rs`. The trait is the contract,
  and `audio/contract.rs` is the test suite every adapter must pass unchanged.
* `src-tauri/src/commands/` is the IPC surface. Handlers are one-line delegations to the backend.
  No audio logic lives above the trait.
* `src-tauri/src/meter.rs` is the only hot path: a 30 Hz loop that is stopped, not throttled,
  while the panel is hidden.
* `src/lib/ipc.ts` is the only frontend file that may import `@tauri-apps/api`. ESLint enforces
  this. Everything else consumes typed wrappers, which is what makes the frontend testable without
  a Tauri runtime.
* `src/features/*/` hold domain components and hooks. Components never call `invoke` directly;
  IPC goes through a hook.
* `src/stores/` hold Zustand state. Peak values never go through a store: they arrive at 30 Hz
  and a store subscription would re-render every row thirty times a second.

Rust is the source of truth for every IPC payload. `src/types/ipc.ts` mirrors it field for field.
When a payload changes, change Rust first and follow in TypeScript.

## Making a change

1. Open an issue first for anything larger than a bug fix. Describe the problem, not the solution,
   so the discussion can settle on the right shape before code exists.
2. Branch from `main`.
3. Write or update a test that fails before your change and passes after it. Backend logic is
   covered by `cargo test`, frontend logic by Vitest and Testing Library.
4. Run `npm run verify`. It must exit 0.
5. Open a pull request. Explain what changed and why, and mention anything you tested by hand
   that the suite cannot cover, such as a permission flow or a specific output device.

Keep pull requests focused. A refactor and a behaviour change in the same PR are hard to review
and harder to revert.

Do not weaken a test, a lint rule, or a threshold to get the gate green. If a gate is wrong, say
so in the pull request and change it deliberately as its own commit.

## Code conventions

Somul controls other applications' audio through operating system APIs whose behaviour is often
invisible from the code itself. Most of the rules below exist to keep that context from being
lost.

### Comments explain why, never what

The code already says what it does. A comment repeating it is noise that goes stale.

```rust
// BAD: restates the code
// Increment the tick counter
state.tick = state.tick.wrapping_add(1);

// GOOD: explains a decision the code cannot show
// Deterministic rather than random so a meter test can assert an exact frame.
let phase = tick.wrapping_mul(7).wrapping_add(index * 29) % 100;
```

If you cannot think of a why, there is probably no comment to write.

### Comments stand on their own

Do not point at anything outside this repository. No design-doc section numbers, no ticket IDs,
no "see the spec", no internal links. A contributor cloning the repo has none of those, and a
reference they cannot follow is worse than no comment.

```rust
// BAD: the reader cannot follow this
// See ARCHITECTURE.md §6.2 for why.
pub struct SessionId(String);

// GOOD: the reason travels with the code
// A PID is not an identity key: one process routinely owns several concurrent sessions
// (Chrome per tab, Discord input and output), and the OS recycles PIDs, so a PID-keyed
// write can land on an unrelated process after a session dies.
pub struct SessionId(String);
```

Linking to a public, stable URL is fine when it genuinely helps, such as an OS vendor's API page
or a tracked upstream bug. Summarise the relevant point inline anyway, because links rot too.

### Document constraints and platform quirks

This is the highest-value comment in the codebase. If behaviour is dictated by something outside
the code, such as an OS API returning a lie or a compositor timing gap, say so, and say what
breaks without the workaround.

```rust
// CoreAudio returns noErr for a device the HAL will not actually adopt as the system
// output. Several virtual and driver-provided devices behave this way. Reporting success
// there would present a control that silently does nothing, so the write is read back.
```

State the failure mode, not just the rule. "Must be called before X" is weak. "Called after X,
the tray never receives the event and the panel opens at the screen centre" is useful.

### Explain magic numbers, or name them

A literal with a non-obvious value gets a constant and a derivation.

```rust
/// Master state is polled every Nth meter tick rather than every tick. The OS volume can be
/// changed from outside the app, and there is no cheaper way to notice than asking. At 30 Hz
/// this works out to roughly 5 Hz, fast enough that dragging the system slider looks live and
/// slow enough to stay off the hot path.
const MASTER_POLL_EVERY_TICKS: u32 = 6;
```

### Public API carries a doc comment

Exported Rust items use `///`. Exported TypeScript uses TSDoc `/** */`. Cover what the caller
needs and cannot infer: units, ranges, ownership, failure modes, and threading.

Units are mandatory wherever a bare number crosses a boundary:

```ts
/** Linear scalar 0.0 to 1.0. Not a percentage, not dB. */
volume: number;
```

Private helpers need a comment only when the why is non-obvious.

### Every `unsafe` block states its soundness invariant

No exceptions. Name the condition that makes the call sound, and why it holds here.

```rust
// SAFETY: `AudioObjectGetPropertyData` writes exactly `size` bytes into `out`. The caller
// passes `size_of::<T>()` and a pointer to a live local of that type, so the write stays
// inside the allocation.
```

### Tests name the rule they defend

A test name states the behaviour in plain language. Add a comment when the test exists to stop a
specific regression, so nobody "simplifies" the assertion away.

```ts
/**
 * Peaks arrive at 30 Hz. Routing them through React state would re-render every subscriber
 * thirty times a second, so this asserts the render count never moves while frames flow.
 */
it('never re-renders a row on a peak update', () => {
```

### Delete rather than comment out

No commented-out code. Version control remembers it. Same for `TODO` without an owner and a
condition: either fix it, or write down what would have to be true to fix it.

### Style

Prose, not shorthand: full sentences, capitalised, with a full stop. Wrap at 100 columns,
matching the code. British or American spelling is fine, just be consistent within a file. No
banner comments or ASCII dividers; file and module structure carry that job.

### Language specifics

**Rust.** A module-level `//!` explains the file's responsibility and the constraint that shaped
it. `#![deny(clippy::all)]` is on and CI runs `clippy -- -D warnings`. No `unwrap()` or `expect()`
outside tests and `main`; adapter code returns `AudioError`.

**TypeScript.** No `any`; use `unknown` with a type guard. Every component is a `React.FC` with
an explicit props interface. Booleans are prefixed `is`, `has`, `should`, or `can`. Handlers are
prefixed `handle`. Hooks are named `use[Feature][Purpose]`.

**CSS.** Comment any rule whose absence would be a subtle bug, such as a vendor prefix a target
browser actually needs.

## Reporting bugs

Open an issue with:

* macOS version and whether the Mac is Apple silicon or Intel
* Somul version, shown in the panel footer
* What you expected and what happened
* Which apps were playing, and whether the Audio Recording permission was granted

If per-app sliders do not move, say whether the panel shows a permission notice. That
distinguishes a permission problem from an engine bug.

## Releases

Releases are built, signed, and published from the maintainer's machine. The updater's private
key is deliberately kept out of CI, and `.github/workflows/release.yml` runs only when triggered
by hand. Contributors do not need to do anything for a release; merged changes ship with the next
one.

A release built by hand needs one step `tauri build` does not do. It notarizes the .app and then
wraps it in a disk image it only signs, so the DMG a user downloads carries no ticket and
Gatekeeper turns it away on first open — while every check run against the .app inside passes.
`./scripts/notarize-dmg.sh <path-to-dmg>` closes that gap and refuses to succeed until `spctl`
accepts the image. The workflow runs it too.

`.env.release.example` is the shape of the environment a release build needs — the signing
identity, the notarization key, and where the updater's private key and its password are read
from. Copy it outside the tree before filling it in.

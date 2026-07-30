# Contributing to Somul

Thanks for helping out. This document covers how we write code comments — the part of the
codebase most likely to rot, and the part a new contributor reads first.

For build and run instructions, see [README.md](README.md).

---

## Code documentation rules

Somul controls other applications' audio through three very different operating system APIs.
Most of the difficult code is difficult because of a platform constraint that is invisible from
the code itself. Comments exist to carry that missing context.

### 1. Comment the *why*, never the *what*

The code already says what it does. A comment repeating it is noise that goes stale.

```rust
// BAD — restates the code
// Increment the tick counter
state.tick = state.tick.wrapping_add(1);

// GOOD — explains a decision the code cannot show
// Deterministic rather than random so a meter test can assert an exact frame.
let phase = tick.wrapping_mul(7).wrapping_add(index * 29) % 100;
```

If you cannot think of a why, there is probably no comment to write.

### 2. Every comment must stand on its own

**Do not point at anything outside this repository.** No design-doc section numbers, no ticket
IDs, no "see the spec", no internal wiki links. A contributor cloning the repo has none of those,
and a reference they cannot follow is worse than no comment — it signals that an explanation
exists while withholding it.

```rust
// BAD — the reader cannot follow this
// See ARCHITECTURE.md §6.2 for why.
pub struct SessionId(String);

// GOOD — the reason travels with the code
// A PID is not an identity key: one process routinely owns several concurrent sessions
// (Chrome per tab, Discord input and output), and the OS recycles PIDs, so a PID-keyed
// write can land on an unrelated process after a session dies.
pub struct SessionId(String);
```

Linking to a **public, stable** URL is fine when it genuinely helps — an OS vendor's API page, a
tracked upstream bug. Summarise the relevant point inline anyway; links rot too.

### 3. Document constraints and platform quirks

This is the highest-value comment in the codebase. If behaviour is dictated by something outside
the code — an OS API returning a lie, a compositor timing gap, a spec requirement — say so, and
say what breaks without the workaround.

```rust
// CoreAudio returns noErr for a device the HAL will not actually adopt as the system
// output — several virtual and driver-provided devices behave this way. Reporting success
// there would present a control that silently does nothing, so the write is read back.
```

State the **failure mode**, not just the rule. "Must be called before X" is weak; "called after X,
the tray never receives the event and the panel opens at the screen centre" is useful.

### 4. Explain magic numbers, or name them

A literal with a non-obvious value gets a constant and a derivation.

```rust
/// Master state is polled every Nth meter tick rather than every tick. The OS volume can be
/// changed from outside the app — menu bar, keyboard keys, System Settings — and there is no
/// cheaper way to notice than asking. At 30 Hz this works out to roughly 5 Hz, fast enough that
/// dragging the system slider looks live and slow enough to stay off the hot path.
const MASTER_POLL_EVERY_TICKS: u32 = 6;
```

### 5. Public API carries a doc comment

Exported Rust items use `///`; exported TypeScript uses TSDoc `/** */`. Cover what the caller
needs and cannot infer: units, ranges, ownership, failure modes, and threading.

Units are mandatory wherever a bare number crosses a boundary:

```ts
/** Linear scalar 0.0–1.0. Not a percentage, not dB. */
volume: number;
```

Private helpers need a comment only when the *why* is non-obvious.

### 6. Every `unsafe` block states its soundness invariant

No exceptions. Name the condition that makes the call sound, and why it holds here.

```rust
// SAFETY: `AudioObjectGetPropertyData` writes exactly `size` bytes into `out`. The caller
// passes `size_of::<T>()` and a pointer to a live local of that type, so the write stays
// inside the allocation.
```

### 7. Tests document the rule they defend

A test name states the behaviour in plain language. Add a comment when the test exists to stop a
specific regression, so nobody "simplifies" the assertion away.

```ts
/**
 * Peaks arrive at 30 Hz. Routing them through React state would re-render every subscriber
 * thirty times a second, so this asserts the render count never moves while frames flow.
 */
it('never re-renders a row on a peak update', () => {
```

### 8. Delete rather than comment out

No commented-out code. Version control remembers it. Same for `TODO` without an owner and a
condition — either fix it, or write down what would have to be true to fix it.

---

## Style

- **Prose, not shorthand.** Full sentences, capitalised, with a full stop. Comments are read far
  more often than written.
- **Wrap at 100 columns**, matching the code.
- **British or American spelling** — just be consistent within a file.
- **No decoration.** No banner comments, no ASCII dividers, no `/* ===== SECTION ===== */`.
  File and module structure carry that job.

## Language specifics

**Rust** — module-level `//!` explains the file's responsibility and the constraint that shaped
it. `#![deny(clippy::all)]` is on; CI runs `clippy -- -D warnings`. No `unwrap()` or `expect()`
outside tests and `main`.

**TypeScript** — no `any`; use `unknown` with a type guard. Every component is a `React.FC` with
an explicit props interface, and every exported prop gets a doc comment when its meaning is not
obvious from the name.

**CSS** — comment any rule whose *absence* would be a subtle bug, such as a vendor prefix a
target browser actually needs.

---

## Before opening a pull request

```bash
npm run verify          # typecheck, lint, tests, clippy, cargo test
npm run audit:contrast  # colour contrast thresholds
```

`verify` must exit 0. Do not weaken a test, a lint rule, or a threshold to get there — if a gate
is wrong, say so in the pull request and change it deliberately.

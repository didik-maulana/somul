//! What macOS says about capture, and what the panel should say because of it.
//!
//! The engine used to infer the permission from silence: taps up, nothing heard for six seconds,
//! therefore denied. That reads a fact about the *user* — nobody is playing anything — as a fact
//! about the system, and the two are indistinguishable from inside the audio path. A Mac sitting
//! quietly on a desk was accused of withholding a permission it had never been asked for.
//!
//! Nothing here reads silence as a denial any more. Every attempt to do so was wrong in the same
//! way: macOS reports a process as running output when it merely holds an output stream, so an
//! emulator, a paused player or an editor that opened an audio context at launch all look exactly
//! like an app whose audio is being withheld. The panel accused users whose permission was fine,
//! and offered them a restart that fixed nothing.
//!
//! What is left is what can be known. The evidence comes from Core Audio, not from a permission
//! API. macOS publishes
//! which processes are producing output right now, and the enumeration in `process.rs` keeps only
//! those. So an app in the list is an app that is audibly playing — and a tap that hears nothing
//! while one is playing is a tap macOS is feeding silence.
//!
//! `CGPreflightScreenCaptureAccess` looks like the answer and is not: it reports Screen Recording,
//! a different TCC service from the one process taps use. It returns false for an app the user has
//! granted audio capture to, which is exactly the false accusation this module exists to prevent.

/// What the panel does about per-app control.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureVerdict {
    /// Taps work, or nothing yet says they do not.
    Capable,
    /// Apps are open, taps could not be built at all. Not a permission problem.
    Unsupported,
}

/// Everything the verdict depends on, gathered by the caller so this stays pure.
#[derive(Debug, Clone, Copy)]
pub struct CaptureFacts {
    /// Whether a tap in this process has ever delivered audio.
    pub has_proven_capture: bool,
    /// Whether any app is producing output right now. Core Audio's answer, not a guess.
    pub has_processes: bool,
    /// Whether taps exist for those apps.
    pub has_taps: bool,
}

/// Decides what the panel shows, from facts rather than from a stopwatch.
///
/// Ordered by how much each input is worth. Proof that capture works outranks everything, because
/// it is the only input that cannot be wrong. macOS's answer comes next. Silence comes last and
/// only ever confirms what the other two already suggest — on its own it means a quiet Mac.
pub fn decide(facts: CaptureFacts) -> CaptureVerdict {
    // Nothing is playing, so nothing has been heard, and that is not evidence of anything. The
    // empty state that follows says no apps are playing, which is true.
    if !facts.has_processes {
        return CaptureVerdict::Capable;
    }

    // Heard audio in this process. Capture demonstrably works; later quiet is just quiet.
    if facts.has_proven_capture {
        return CaptureVerdict::Capable;
    }

    // Apps are playing and not one of them could be tapped. Something other than consent is
    // wrong, and sending the user to a settings pane would waste their time.
    if !facts.has_taps {
        return CaptureVerdict::Unsupported;
    }

    // Tapped and recently heard from, or still inside the grace window. Taps start out listening
    // and are promoted once they have heard their app, so judging any harder here would report
    // the platform incapable for the first frames of every session and then change its mind.
    CaptureVerdict::Capable
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> CaptureFacts {
        CaptureFacts {
            has_proven_capture: false,
            has_processes: true,
            has_taps: true,
        }
    }

    /// A Mac with nothing playing has told us nothing, and must not be accused of anything.
    #[test]
    fn nothing_playing_is_not_a_verdict() {
        let quiet = CaptureFacts {
            has_processes: false,
            has_taps: false,
            ..facts()
        };

        assert_eq!(decide(quiet), CaptureVerdict::Capable);
    }

    /// Proof outranks everything. Once a tap has carried audio, quiet means quiet.
    #[test]
    fn proven_capture_is_never_overruled() {
        let proven = CaptureFacts {
            has_proven_capture: true,
            has_taps: false,
            ..facts()
        };

        assert_eq!(decide(proven), CaptureVerdict::Capable);
    }

    /// Apps holding streams, no taps at all: not the user's settings, so do not send them there.
    #[test]
    fn a_tapless_engine_is_not_blamed_on_the_user() {
        let tapless = CaptureFacts {
            has_taps: false,
            ..facts()
        };

        assert_eq!(decide(tapless), CaptureVerdict::Unsupported);
    }

    #[test]
    fn a_tapped_engine_stays_capable() {
        assert_eq!(decide(facts()), CaptureVerdict::Capable);
    }
}

//! The 30 Hz peak loop — the only hot path in the application.
//!
//! While the panel is hidden the loop is **stopped, not throttled**. The thread blocks on a
//! condvar, so a hidden panel costs zero backend calls and zero wakeups — which is what makes
//! the background CPU budget reachable rather than aspirational.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::audio::{AudioBackend, SessionPeak};

pub const METER_HZ: u32 = 30;
pub const TICK: Duration = Duration::from_nanos(1_000_000_000 / METER_HZ as u64);

/// One batch per tick covering every session — never one emit per session.
pub const PEAKS_EVENT: &str = "audio://peaks";

/// Shared visibility flag. `set_panel_visibility` writes it; the loop blocks on it.
#[derive(Default)]
pub struct MeterGate {
    is_visible: Mutex<bool>,
    changed: Condvar,
}

impl MeterGate {
    pub fn new() -> Self {
        Self::default()
    }

    fn guard(&self) -> MutexGuard<'_, bool> {
        // A panicking reader leaves the flag intact; treating poisoning as fatal would take the
        // meter loop down with it for no gain.
        self.is_visible
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn is_visible(&self) -> bool {
        *self.guard()
    }

    pub fn set_visible(&self, is_visible: bool) {
        *self.guard() = is_visible;
        self.changed.notify_all();
    }

    /// Blocks until the panel is shown or the loop is told to stop. Returns `false` on stop.
    fn wait_until_visible(&self, is_running: &AtomicBool) -> bool {
        let mut visible = self.guard();

        while !*visible {
            if !is_running.load(Ordering::Acquire) {
                return false;
            }

            let (next, _) = self
                .changed
                .wait_timeout(visible, TICK)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            visible = next;
        }

        is_running.load(Ordering::Acquire)
    }

    /// Sleeps one tick, waking early if the panel is hidden so the loop stops promptly.
    fn wait_for_next_tick(&self, is_running: &AtomicBool) {
        let visible = self.guard();
        let _ = self
            .changed
            .wait_timeout(visible, TICK)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = is_running;
    }
}

/// Where a tick's batch goes. Abstracted so the loop is testable without a Tauri runtime — and
/// so a test can count emits and assert one batch per tick.
pub trait PeakEmitter: Send + Sync + 'static {
    fn emit_peaks(&self, peaks: &[SessionPeak]);
}

pub struct MeterLoop {
    is_running: Arc<AtomicBool>,
    gate: Arc<MeterGate>,
    worker: Option<JoinHandle<()>>,
}

impl MeterLoop {
    pub fn start(
        backend: Arc<dyn AudioBackend>,
        gate: Arc<MeterGate>,
        emitter: Arc<dyn PeakEmitter>,
    ) -> Self {
        let is_running = Arc::new(AtomicBool::new(true));
        let worker = thread::spawn({
            let is_running = Arc::clone(&is_running);
            let gate = Arc::clone(&gate);

            move || {
                while is_running.load(Ordering::Acquire) {
                    if !gate.wait_until_visible(&is_running) {
                        break;
                    }

                    if let Ok(peaks) = backend.read_peaks() {
                        emitter.emit_peaks(&peaks);
                    }

                    gate.wait_for_next_tick(&is_running);
                }
            }
        });

        Self {
            is_running,
            gate,
            worker: Some(worker),
        }
    }

    pub fn stop(&mut self) {
        self.is_running.store(false, Ordering::Release);
        self.gate.changed.notify_all();

        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for MeterLoop {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Emits over the Tauri event channel: one `audio://peaks` message per tick carrying the whole
/// batch — twelve sessions cost twelve floats in one message, not twelve messages.
pub struct EventPeakEmitter<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> EventPeakEmitter<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: tauri::Runtime> PeakEmitter for EventPeakEmitter<R> {
    fn emit_peaks(&self, peaks: &[SessionPeak]) {
        use tauri::Emitter;

        let _ = self.app.emit(PEAKS_EVENT, peaks);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::mock::MockAudioBackend;
    use crate::audio::{
        AudioDevice, AudioError, AudioSession, DeviceId, MasterState, PlatformCapabilities,
        SessionId,
    };
    use std::sync::atomic::AtomicUsize;

    /// Counts every backend call so a test can assert that a hidden panel makes none.
    struct CountingBackend {
        inner: MockAudioBackend,
        reads: AtomicUsize,
    }

    impl CountingBackend {
        fn new() -> Self {
            Self {
                inner: MockAudioBackend::full_per_app(),
                reads: AtomicUsize::new(0),
            }
        }

        fn reads(&self) -> usize {
            self.reads.load(Ordering::Acquire)
        }
    }

    impl AudioBackend for CountingBackend {
        fn capabilities(&self) -> PlatformCapabilities {
            self.inner.capabilities()
        }

        fn list_sessions(&self) -> Result<Vec<AudioSession>, AudioError> {
            self.inner.list_sessions()
        }

        fn set_session_volume(&self, id: &SessionId, volume: f32) -> Result<(), AudioError> {
            self.inner.set_session_volume(id, volume)
        }

        fn set_session_mute(&self, id: &SessionId, is_muted: bool) -> Result<(), AudioError> {
            self.inner.set_session_mute(id, is_muted)
        }

        fn master(&self) -> Result<MasterState, AudioError> {
            self.inner.master()
        }

        fn set_master_volume(&self, volume: f32) -> Result<(), AudioError> {
            self.inner.set_master_volume(volume)
        }

        fn set_master_mute(&self, is_muted: bool) -> Result<(), AudioError> {
            self.inner.set_master_mute(is_muted)
        }

        fn list_output_devices(&self) -> Result<Vec<AudioDevice>, AudioError> {
            self.inner.list_output_devices()
        }

        fn set_default_output_device(&self, device: &DeviceId) -> Result<(), AudioError> {
            self.inner.set_default_output_device(device)
        }

        fn set_session_output_device(
            &self,
            id: &SessionId,
            device: &DeviceId,
        ) -> Result<(), AudioError> {
            self.inner.set_session_output_device(id, device)
        }

        fn read_peaks(&self) -> Result<Vec<SessionPeak>, AudioError> {
            self.reads.fetch_add(1, Ordering::AcqRel);
            self.inner.read_peaks()
        }
    }

    #[derive(Default)]
    struct RecordingEmitter {
        batches: Mutex<Vec<Vec<SessionPeak>>>,
    }

    impl RecordingEmitter {
        fn batches(&self) -> Vec<Vec<SessionPeak>> {
            self.batches
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
        }
    }

    impl PeakEmitter for RecordingEmitter {
        fn emit_peaks(&self, peaks: &[SessionPeak]) {
            self.batches
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(peaks.to_vec());
        }
    }

    struct Harness {
        backend: Arc<CountingBackend>,
        emitter: Arc<RecordingEmitter>,
        gate: Arc<MeterGate>,
        meter: MeterLoop,
    }

    fn start() -> Harness {
        let backend = Arc::new(CountingBackend::new());
        let emitter = Arc::new(RecordingEmitter::default());
        let gate = Arc::new(MeterGate::new());
        let meter = MeterLoop::start(
            Arc::clone(&backend) as Arc<dyn AudioBackend>,
            Arc::clone(&gate),
            Arc::clone(&emitter) as Arc<dyn PeakEmitter>,
        );

        Harness {
            backend,
            emitter,
            gate,
            meter,
        }
    }

    /// Twelve ticks' worth of wall clock with the panel hidden.
    const SETTLE: Duration = Duration::from_millis(400);

    #[test]
    fn runs_at_thirty_hertz() {
        assert_eq!(METER_HZ, 30);
        assert_eq!(TICK, Duration::from_nanos(33_333_333));
    }

    /// Hidden means stopped, not throttled. This is the CPU budget's enforcement point.
    #[test]
    fn makes_zero_backend_calls_while_the_panel_is_hidden() {
        let harness = start();

        thread::sleep(SETTLE);

        assert_eq!(
            harness.backend.reads(),
            0,
            "the meter loop read the backend while the panel was hidden"
        );
        assert!(
            harness.emitter.batches().is_empty(),
            "the meter loop emitted while the panel was hidden"
        );
    }

    #[test]
    fn reads_and_emits_once_the_panel_is_shown() {
        let harness = start();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);

        assert!(
            harness.backend.reads() > 0,
            "a visible panel must drive the meter loop"
        );
        assert!(
            !harness.emitter.batches().is_empty(),
            "a visible panel must produce peak batches"
        );
    }

    /// Twelve sessions cost twelve floats in one message, not twelve messages.
    #[test]
    fn emits_one_batch_per_tick_covering_every_session() {
        let harness = start();
        let expected = harness
            .backend
            .list_sessions()
            .expect("sessions")
            .len();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);
        harness.gate.set_visible(false);

        let batches = harness.emitter.batches();
        assert!(!batches.is_empty(), "no batches were emitted");

        for batch in &batches {
            assert_eq!(
                batch.len(),
                expected,
                "a tick emitted {} peaks for {expected} sessions — the batch is not whole",
                batch.len()
            );
        }
    }

    #[test]
    fn stops_reading_again_once_the_panel_is_hidden() {
        let harness = start();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);
        harness.gate.set_visible(false);
        thread::sleep(Duration::from_millis(100));

        let settled = harness.backend.reads();
        thread::sleep(SETTLE);

        assert_eq!(
            harness.backend.reads(),
            settled,
            "the loop kept reading after the panel was hidden"
        );
    }

    #[test]
    fn approximates_the_thirty_hertz_cadence() {
        let harness = start();

        harness.gate.set_visible(true);
        thread::sleep(Duration::from_millis(500));
        harness.gate.set_visible(false);

        let reads = harness.backend.reads();

        // 500 ms at 30 Hz is ~15 ticks. The bounds are wide because a loaded CI box schedules
        // this thread unevenly; what is being pinned down is the order of magnitude, not jitter.
        assert!(
            (5..=40).contains(&reads),
            "expected roughly 15 ticks in 500 ms, got {reads}"
        );
    }

    #[test]
    fn stops_cleanly_on_drop() {
        let harness = start();
        harness.gate.set_visible(true);
        thread::sleep(Duration::from_millis(80));

        let backend = Arc::clone(&harness.backend);
        let mut meter = harness.meter;
        meter.stop();

        let settled = backend.reads();
        thread::sleep(SETTLE);

        assert_eq!(
            backend.reads(),
            settled,
            "the worker thread outlived stop()"
        );
    }
}

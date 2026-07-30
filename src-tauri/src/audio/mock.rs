use std::sync::Mutex;

use super::{
    clamp_unit_scalar, AudioBackend, AudioDevice, AudioError, AudioSession, DeviceId, MasterState,
    PlatformCapabilities, SessionId, SessionPeak, SessionState,
};

const MASTER_ONLY_REASON: &str =
    "macOS exposes master volume only. Per-app control arrives in v1.2 via Core Audio process taps.";

struct MockState {
    sessions: Vec<AudioSession>,
    devices: Vec<AudioDevice>,
    master: MasterState,
    tick: u32,
}

/// Deterministic in-memory backend. ARCHITECTURE.md §14 makes this a release requirement, not a
/// convenience: it is the only way to exercise the frontend and the contract suite without audio
/// hardware in CI.
pub struct MockAudioBackend {
    capabilities: PlatformCapabilities,
    state: Mutex<MockState>,
}

impl MockAudioBackend {
    /// Windows/Linux shape — per-app volume, mute, and metering all present.
    pub fn full_per_app() -> Self {
        Self {
            capabilities: PlatformCapabilities::full_per_app(),
            state: Mutex::new(seed_state()),
        }
    }

    /// macOS v1 shape (§2.2.5) — master only, with the reason the UI renders verbatim.
    pub fn master_only() -> Self {
        Self {
            capabilities: PlatformCapabilities::master_only(MASTER_ONLY_REASON),
            state: Mutex::new(MockState {
                sessions: Vec::new(),
                ..seed_state()
            }),
        }
    }

    fn state(&self) -> Result<std::sync::MutexGuard<'_, MockState>, AudioError> {
        self.state
            .lock()
            .map_err(|_| AudioError::BackendFailure("mock backend state is poisoned".to_owned()))
    }

    fn require_per_app(&self) -> Result<(), AudioError> {
        if self.capabilities.has_per_app_volume {
            return Ok(());
        }

        Err(AudioError::Unsupported(MASTER_ONLY_REASON.to_owned()))
    }
}

fn seed_session(
    identifier: &str,
    pid: u32,
    display_name: &str,
    process_name: &str,
    volume: f32,
    state: SessionState,
) -> AudioSession {
    AudioSession {
        session_id: SessionId::from_backend_identifier(identifier)
            .unwrap_or_else(|_| unreachable!("seed identifiers are namespaced, never all digits")),
        pid,
        display_name: display_name.to_owned(),
        process_name: process_name.to_owned(),
        icon_data_uri: None,
        volume,
        is_muted: false,
        output_device_id: Some(DeviceId::new("mock:speakers")),
        state,
    }
}

fn seed_state() -> MockState {
    MockState {
        sessions: vec![
            seed_session(
                "mock:session:spotify",
                4821,
                "Spotify",
                "spotify.exe",
                0.74,
                SessionState::Active,
            ),
            seed_session(
                "mock:session:chrome-tab-1",
                7310,
                "Google Chrome",
                "chrome.exe",
                0.5,
                SessionState::Active,
            ),
            seed_session(
                "mock:session:discord-out",
                2044,
                "Discord",
                "discord.exe",
                0.35,
                SessionState::Inactive,
            ),
        ],
        devices: vec![
            AudioDevice {
                device_id: DeviceId::new("mock:speakers"),
                name: "Built-in Speakers".to_owned(),
                is_default: true,
                is_available: true,
            },
            AudioDevice {
                device_id: DeviceId::new("mock:headphones"),
                name: "USB Headphones".to_owned(),
                is_default: false,
                is_available: true,
            },
        ],
        master: MasterState {
            device_id: DeviceId::new("mock:speakers"),
            device_name: "Built-in Speakers".to_owned(),
            volume: 0.62,
            is_muted: false,
        },
    tick: 0,
    }
}

impl AudioBackend for MockAudioBackend {
    fn capabilities(&self) -> PlatformCapabilities {
        self.capabilities.clone()
    }

    fn list_sessions(&self) -> Result<Vec<AudioSession>, AudioError> {
        self.require_per_app()?;

        Ok(self.state()?.sessions.clone())
    }

    fn set_session_volume(&self, id: &SessionId, volume: f32) -> Result<(), AudioError> {
        self.require_per_app()?;

        let mut state = self.state()?;
        let session = state
            .sessions
            .iter_mut()
            .find(|session| &session.session_id == id)
            .ok_or_else(|| AudioError::SessionNotFound(id.clone()))?;

        session.volume = clamp_unit_scalar(volume);

        Ok(())
    }

    fn set_session_mute(&self, id: &SessionId, is_muted: bool) -> Result<(), AudioError> {
        self.require_per_app()?;

        let mut state = self.state()?;
        let session = state
            .sessions
            .iter_mut()
            .find(|session| &session.session_id == id)
            .ok_or_else(|| AudioError::SessionNotFound(id.clone()))?;

        session.is_muted = is_muted;

        Ok(())
    }

    fn master(&self) -> Result<MasterState, AudioError> {
        Ok(self.state()?.master.clone())
    }

    fn set_master_volume(&self, volume: f32) -> Result<(), AudioError> {
        self.state()?.master.volume = clamp_unit_scalar(volume);

        Ok(())
    }

    fn set_master_mute(&self, is_muted: bool) -> Result<(), AudioError> {
        self.state()?.master.is_muted = is_muted;

        Ok(())
    }

    fn list_output_devices(&self) -> Result<Vec<AudioDevice>, AudioError> {
        Ok(self.state()?.devices.clone())
    }

    fn set_default_output_device(&self, device: &DeviceId) -> Result<(), AudioError> {
        let mut state = self.state()?;

        if !state
            .devices
            .iter()
            .any(|candidate| &candidate.device_id == device)
        {
            return Err(AudioError::DeviceNotFound(device.clone()));
        }

        for candidate in &mut state.devices {
            candidate.is_default = &candidate.device_id == device;
        }

        let name = state
            .devices
            .iter()
            .find(|candidate| &candidate.device_id == device)
            .map(|candidate| candidate.name.clone())
            .unwrap_or_default();

        state.master.device_id = device.clone();
        state.master.device_name = name;

        Ok(())
    }

    fn set_session_output_device(
        &self,
        _id: &SessionId,
        _device: &DeviceId,
    ) -> Result<(), AudioError> {
        Err(AudioError::Unsupported(
            "per-app output routing is v1.1".to_owned(),
        ))
    }

    fn read_peaks(&self) -> Result<Vec<SessionPeak>, AudioError> {
        let mut state = self.state()?;
        state.tick = state.tick.wrapping_add(1);
        let tick = state.tick;

        Ok(state
            .sessions
            .iter()
            .enumerate()
            .map(|(index, session)| SessionPeak {
                session_id: session.session_id.clone(),
                peak: synthetic_peak(tick, index, session),
            })
            .collect())
    }
}

/// Deterministic rather than random so a meter test can assert an exact frame.
fn synthetic_peak(tick: u32, index: usize, session: &AudioSession) -> f32 {
    if session.is_muted || session.state != SessionState::Active {
        return 0.0;
    }

    let phase = (tick.wrapping_mul(7).wrapping_add(index as u32 * 29)) % 100;

    clamp_unit_scalar(session.volume * (phase as f32 / 100.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    crate::audio_backend_contract!(full_per_app, MockAudioBackend::full_per_app());
    crate::audio_backend_contract!(master_only, MockAudioBackend::master_only());

    #[test]
    fn produces_the_same_peak_sequence_on_every_run() {
        let first = MockAudioBackend::full_per_app();
        let second = MockAudioBackend::full_per_app();

        for _ in 0..5 {
            assert_eq!(
                first.read_peaks().expect("peaks"),
                second.read_peaks().expect("peaks")
            );
        }
    }

    #[test]
    fn advances_the_peak_sequence_between_ticks() {
        let backend = MockAudioBackend::full_per_app();

        let first = backend.read_peaks().expect("peaks");
        let second = backend.read_peaks().expect("peaks");

        assert_ne!(first, second);
    }

    #[test]
    fn silences_the_peak_of_a_muted_session() {
        let backend = MockAudioBackend::full_per_app();
        let sessions = backend.list_sessions().expect("sessions");
        let target = &sessions[0].session_id;

        backend.set_session_mute(target, true).expect("mute");

        let peak = backend
            .read_peaks()
            .expect("peaks")
            .into_iter()
            .find(|peak| &peak.session_id == target)
            .expect("muted session still reports a peak entry");

        assert_eq!(peak.peak, 0.0);
    }

    #[test]
    fn master_only_reports_the_reason_the_ui_renders() {
        let capabilities = MockAudioBackend::master_only().capabilities();

        assert_eq!(
            capabilities.unsupported_reason.as_deref(),
            Some(MASTER_ONLY_REASON)
        );
    }
}

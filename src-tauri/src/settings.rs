//! Persisted settings and their migration path.
//!
//! Presets are keyed by `processName`, not `sessionId`, because they must survive an application
//! restart and a `sessionId` does not — the OS issues a fresh one every time an app reopens.
//!
//! Migration preserves unknown keys. A user who downgrades and re-upgrades must not lose data
//! written by the newer build, so migration edits the map it was given instead of rebuilding it
//! from a struct.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::shortcut::DEFAULT_HOTKEY;

/// Bumped on every breaking change. Each step gets a branch in [`migrate`].
pub const CURRENT_SCHEMA_VERSION: u32 = 3;

/// The store file inside the platform config directory.
pub const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub hotkey: String,
    pub theme: Theme,
    pub should_launch_at_login: bool,
    /// Whether app rows carry a peak meter. On by default — the meter is the reason most people
    /// can tell which row is the one making noise.
    pub should_show_peak_meter: bool,
    /// processName -> deviceId (v1.1).
    pub routing_presets: BTreeMap<String, String>,
    /// processName -> last volume scalar. Written by the audio path, not by the settings view —
    /// see [`crate::memory`] and [`preserve_memory`].
    pub volume_memory: BTreeMap<String, f32>,
    /// processName -> last mute state. Same ownership as [`AppSettings::volume_memory`].
    pub mute_memory: BTreeMap<String, bool>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            hotkey: DEFAULT_HOTKEY.to_owned(),
            theme: Theme::System,
            should_launch_at_login: false,
            should_show_peak_meter: true,
            routing_presets: BTreeMap::new(),
            volume_memory: BTreeMap::new(),
            mute_memory: BTreeMap::new(),
        }
    }
}

fn stored_version(stored: &Map<String, Value>) -> u32 {
    stored
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .and_then(|version| u32::try_from(version).ok())
        .unwrap_or(0)
}

/// Brings a stored map up to [`CURRENT_SCHEMA_VERSION`], leaving every key it does not
/// understand exactly where it found it.
pub fn migrate(mut stored: Map<String, Value>) -> Map<String, Value> {
    if stored_version(&stored) < 1 {
        let defaults = AppSettings::default();

        insert_missing(&mut stored, "hotkey", Value::from(defaults.hotkey));
        insert_missing(&mut stored, "theme", Value::from("system"));
        insert_missing(&mut stored, "shouldLaunchAtLogin", Value::from(false));
        insert_missing(&mut stored, "routingPresets", Value::Object(Map::new()));
        insert_missing(&mut stored, "volumeMemory", Value::Object(Map::new()));
    }

    if stored_version(&stored) < 2 {
        insert_missing(&mut stored, "muteMemory", Value::Object(Map::new()));
    }

    // Defaults to on for an existing install as well as a new one. The meter shipped enabled, so
    // an upgrade that silently turned it off would read as the feature having been removed.
    if stored_version(&stored) < 3 {
        insert_missing(&mut stored, "shouldShowPeakMeter", Value::from(true));
    }

    stored.insert(
        "schemaVersion".to_owned(),
        Value::from(CURRENT_SCHEMA_VERSION),
    );

    stored
}

fn insert_missing(stored: &mut Map<String, Value>, key: &str, value: Value) {
    if !stored.contains_key(key) {
        stored.insert(key.to_owned(), value);
    }
}

/// Reads settings out of a migrated map. A field that fails to parse falls back to its default
/// rather than discarding the whole file — one bad key must not reset a user's configuration.
pub fn from_stored(stored: &Map<String, Value>) -> AppSettings {
    let defaults = AppSettings::default();

    AppSettings {
        schema_version: stored_version(stored),
        hotkey: stored
            .get("hotkey")
            .and_then(Value::as_str)
            .filter(|hotkey| !hotkey.trim().is_empty())
            .map_or(defaults.hotkey, str::to_owned),
        theme: stored
            .get("theme")
            .and_then(|theme| serde_json::from_value(theme.clone()).ok())
            .unwrap_or(defaults.theme),
        should_launch_at_login: stored
            .get("shouldLaunchAtLogin")
            .and_then(Value::as_bool)
            .unwrap_or(defaults.should_launch_at_login),
        should_show_peak_meter: stored
            .get("shouldShowPeakMeter")
            .and_then(Value::as_bool)
            .unwrap_or(defaults.should_show_peak_meter),
        routing_presets: string_map(stored.get("routingPresets")),
        volume_memory: scalar_map(stored.get("volumeMemory")),
        mute_memory: bool_map(stored.get("muteMemory")),
    }
}

/// Keeps the per-app memory that is already on disk when settings arrive from the UI.
///
/// Memory is written by the audio path while the panel is open, but the settings view round-trips
/// the whole struct as it read it — at startup, in practice. Echoing that copy back would roll
/// every level remembered since then back to the startup snapshot, so a theme change would silently
/// undo an evening of mixing.
pub fn preserve_memory(stored: &AppSettings, incoming: &mut AppSettings) {
    incoming.volume_memory.clone_from(&stored.volume_memory);
    incoming.mute_memory.clone_from(&stored.mute_memory);
}

fn string_map(value: Option<&Value>) -> BTreeMap<String, String> {
    value
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_owned()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn scalar_map(value: Option<&Value>) -> BTreeMap<String, f32> {
    value
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(key, value)| {
                    value
                        .as_f64()
                        .map(|scalar| (key.clone(), crate::audio::clamp_unit_scalar(scalar as f32)))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn bool_map(value: Option<&Value>) -> BTreeMap<String, bool> {
    value
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(key, value)| value.as_bool().map(|flag| (key.clone(), flag)))
                .collect()
        })
        .unwrap_or_default()
}

/// Reads settings off disk, migrating whatever version is there.
///
/// A store that cannot be opened yields defaults rather than an error: the panel must still open
/// on a fresh install, or on a machine where the config directory is not writable.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> AppSettings {
    let Ok(store) = app.store(SETTINGS_FILE) else {
        return AppSettings::default();
    };

    let stored: Map<String, Value> = store.entries().into_iter().collect();

    from_stored(&migrate(stored))
}

/// Writes settings back, preserving any key this build does not understand.
///
/// The stored map is migrated first so unknown keys survive the round trip — writing the struct
/// alone would silently drop anything a newer build had written.
pub fn save<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) -> Result<(), String> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| error.to_string())?;

    let mut merged: Map<String, Value> = migrate(store.entries().into_iter().collect());
    merged.extend(to_stored(settings));

    for (key, value) in merged {
        store.set(key, value);
    }

    store.save().map_err(|error| error.to_string())
}

pub fn to_stored(settings: &AppSettings) -> Map<String, Value> {
    serde_json::to_value(settings)
        .ok()
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stored(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => unreachable!("test fixtures are objects"),
        }
    }

    #[test]
    fn defaults_match_the_documented_schema() {
        let settings = AppSettings::default();

        assert_eq!(settings.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(settings.hotkey, "CmdOrCtrl+Shift+V");
        assert_eq!(settings.theme, Theme::System);
        assert!(!settings.should_launch_at_login);
        assert!(settings.routing_presets.is_empty());
        assert!(settings.volume_memory.is_empty());
        assert!(settings.mute_memory.is_empty());
    }

    #[test]
    fn serializes_in_camel_case() {
        let encoded = to_stored(&AppSettings::default());

        for key in [
            "schemaVersion",
            "hotkey",
            "theme",
            "shouldLaunchAtLogin",
            "routingPresets",
            "volumeMemory",
            "muteMemory",
        ] {
            assert!(encoded.contains_key(key), "{key} is missing from the store");
        }
    }

    /// The meter shipped enabled, so an upgrade that silently switched it off would read as the
    /// feature having been removed rather than as a default.
    #[test]
    fn an_upgraded_store_keeps_the_peak_meter_on() {
        let stored = serde_json::json!({ "schemaVersion": 2, "hotkey": "Cmd+Shift+V" });
        let migrated = migrate(stored.as_object().expect("object").clone());

        assert!(from_stored(&migrated).should_show_peak_meter);
    }

    #[test]
    fn a_stored_preference_to_hide_the_meter_survives_migration() {
        let stored = serde_json::json!({
            "schemaVersion": 2,
            "shouldShowPeakMeter": false,
        });
        let migrated = migrate(stored.as_object().expect("object").clone());

        assert!(!from_stored(&migrated).should_show_peak_meter);
    }

    #[test]
    fn migrates_an_empty_store_to_the_current_version() {
        let migrated = migrate(Map::new());

        assert_eq!(stored_version(&migrated), CURRENT_SCHEMA_VERSION);
        assert_eq!(from_stored(&migrated), AppSettings::default());
    }

    #[test]
    fn migrates_a_versionless_store_without_losing_set_values() {
        let migrated = migrate(stored(json!({ "hotkey": "Alt+Shift+M" })));

        let settings = from_stored(&migrated);

        assert_eq!(settings.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(settings.hotkey, "Alt+Shift+M");
    }

    /// A downgrade must not destroy data. Keys the running build does not understand are
    /// carried across untouched.
    #[test]
    fn preserves_unknown_keys_across_migration() {
        let migrated = migrate(stored(json!({
            "schemaVersion": 0,
            "equalizerBands": [1.0, 2.0, 3.0],
            "midiControllerId": "launchpad-mk3",
        })));

        assert_eq!(
            migrated.get("equalizerBands"),
            Some(&json!([1.0, 2.0, 3.0])),
            "an unknown key was dropped by migration"
        );
        assert_eq!(
            migrated.get("midiControllerId"),
            Some(&json!("launchpad-mk3"))
        );
    }

    #[test]
    fn preserves_unknown_keys_written_by_a_newer_build() {
        let migrated = migrate(stored(json!({
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "hotkey": "Alt+F1",
            "settingFromTheFuture": { "nested": true },
        })));

        assert_eq!(
            migrated.get("settingFromTheFuture"),
            Some(&json!({ "nested": true }))
        );
        assert_eq!(from_stored(&migrated).hotkey, "Alt+F1");
    }

    #[test]
    fn migration_is_idempotent() {
        let once = migrate(stored(json!({ "hotkey": "Alt+Shift+M" })));
        let twice = migrate(once.clone());

        assert_eq!(once, twice);
    }

    /// Presets are keyed by processName, which survives a restart. A sessionId does not.
    #[test]
    fn keys_presets_by_process_name() {
        let migrated = migrate(stored(json!({
            "routingPresets": { "spotify.exe": "device:headphones" },
            "volumeMemory": { "spotify.exe": 0.42 },
            "muteMemory": { "spotify.exe": true },
        })));

        let settings = from_stored(&migrated);

        assert_eq!(
            settings
                .routing_presets
                .get("spotify.exe")
                .map(String::as_str),
            Some("device:headphones")
        );
        assert_eq!(settings.volume_memory.get("spotify.exe"), Some(&0.42));
        assert_eq!(settings.mute_memory.get("spotify.exe"), Some(&true));
    }

    /// v1 shipped without mute memory. Upgrading must add it without disturbing the volumes a
    /// user already accumulated.
    ///
    /// Asserts against `CURRENT_SCHEMA_VERSION` rather than the version that followed v1: what
    /// this pins is that an old store arrives intact at whatever the current schema is, and
    /// naming one version froze the test to the day it was written.
    #[test]
    fn migrates_a_v1_store_to_the_current_version_without_losing_remembered_volumes() {
        let migrated = migrate(stored(json!({
            "schemaVersion": 1,
            "volumeMemory": { "spotify.exe": 0.3 },
        })));

        let settings = from_stored(&migrated);

        assert_eq!(settings.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(settings.volume_memory.get("spotify.exe"), Some(&0.3));
        assert!(settings.mute_memory.is_empty());
    }

    /// The settings view round-trips the whole struct, and its copy of the memory is as old as
    /// the panel session. Applying it would undo every level remembered since.
    #[test]
    fn keeps_stored_memory_when_settings_arrive_from_the_ui() {
        let on_disk = AppSettings {
            volume_memory: BTreeMap::from([("spotify.exe".to_owned(), 0.3)]),
            mute_memory: BTreeMap::from([("discord.exe".to_owned(), true)]),
            ..AppSettings::default()
        };
        let mut incoming = AppSettings {
            theme: Theme::Dark,
            ..AppSettings::default()
        };

        preserve_memory(&on_disk, &mut incoming);

        assert_eq!(incoming.volume_memory, on_disk.volume_memory);
        assert_eq!(incoming.mute_memory, on_disk.mute_memory);
        assert_eq!(incoming.theme, Theme::Dark, "the rest of the change stands");
    }

    #[test]
    fn clamps_a_remembered_volume_into_the_unit_range() {
        let migrated = migrate(stored(json!({
            "volumeMemory": { "spotify.exe": 4.5, "chrome.exe": -2.0 },
        })));

        let settings = from_stored(&migrated);

        assert_eq!(settings.volume_memory.get("spotify.exe"), Some(&1.0));
        assert_eq!(settings.volume_memory.get("chrome.exe"), Some(&0.0));
    }

    /// One unreadable field must not reset the whole file.
    #[test]
    fn falls_back_per_field_rather_than_discarding_the_store() {
        let settings = from_stored(&stored(json!({
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "hotkey": "Alt+F2",
            "theme": "chartreuse",
            "shouldLaunchAtLogin": "yes please",
        })));

        assert_eq!(settings.hotkey, "Alt+F2");
        assert_eq!(settings.theme, Theme::System);
        assert!(!settings.should_launch_at_login);
    }

    #[test]
    fn ignores_a_blank_hotkey() {
        let settings = from_stored(&stored(json!({ "hotkey": "   " })));

        assert_eq!(settings.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn round_trips_through_the_store_representation() {
        let settings = AppSettings {
            hotkey: "Alt+Shift+M".to_owned(),
            theme: Theme::Dark,
            should_launch_at_login: true,
            routing_presets: BTreeMap::from([("spotify.exe".to_owned(), "dev:1".to_owned())]),
            volume_memory: BTreeMap::from([("spotify.exe".to_owned(), 0.25)]),
            mute_memory: BTreeMap::from([("chrome.exe".to_owned(), true)]),
            ..AppSettings::default()
        };

        assert_eq!(from_stored(&to_stored(&settings)), settings);
    }

    #[test]
    fn stores_the_theme_as_a_camel_case_string() {
        assert_eq!(
            to_stored(&AppSettings::default()).get("theme"),
            Some(&json!("system"))
        );
    }
}

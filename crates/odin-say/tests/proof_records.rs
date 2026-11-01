//! Proof records: every written JSONL line parses, carries `record_kind` plus the six legacy
//! CMUX delivery-proof fields with the right types, and the refusal records cannot be read
//! as deliveries. Log path and sender role come from flag, then environment, then the
//! cloud-friendly default (no home path is baked into the crate).

use odin_say::clock::FakeClock;
use odin_say::cmux::StubCmux;
use odin_say::config::{Config, ConfigFlags};
use odin_say::identity::HarnessSelector;
use odin_say::proof::{self, ProofEntry, RECORD_KIND_DELIVERY, RECORD_KIND_SEND_REFUSAL};
use odin_say::rules::PaneRules;
use odin_say::say::{deliver, DeliveryOptions, Outcome};
use std::path::PathBuf;
use std::time::Duration;
use tempfile::tempdir;

macro_rules! screen {
    ($name:literal) => {
        include_str!(concat!("fixtures/screens/", $name, ".txt"))
    };
}

const SURFACE: &str = "surface:7";
const NOW: &str = "2026-10-31T00:00:00Z";

fn options() -> DeliveryOptions {
    DeliveryOptions {
        poll: Duration::from_secs(5),
        wait: Duration::from_secs(180),
    }
}

fn deliver_against(screens: &[&str], text: &str) -> Outcome {
    let cmux = StubCmux::new(screens);
    let clock = FakeClock::new();
    deliver(
        &cmux,
        &clock,
        PaneRules::embedded(),
        &HarnessSelector::default(),
        SURFACE,
        text,
        &options(),
    )
}

fn write_and_parse(path: &std::path::Path, outcome: &Outcome, role: &str) -> serde_json::Value {
    let entry = ProofEntry::for_outcome("say", SURFACE, outcome, role, NOW.to_string());
    proof::append(path, &entry).expect("append");
    let text = std::fs::read_to_string(path).expect("read log");
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 1, "one record per attempt");
    serde_json::from_str(lines[0]).expect("record is JSON")
}

#[test]
fn a_delivery_record_carries_record_kind_and_the_six_legacy_fields() {
    let dir = tempdir().expect("tmp");
    let path = dir.path().join("proof.jsonl");
    let outcome = deliver_against(
        &[screen!("codex_idle"), screen!("codex_acked_after_send")],
        "run the gate",
    );
    let value = write_and_parse(&path, &outcome, "EXEC PM");

    assert_eq!(value["record_kind"], RECORD_KIND_DELIVERY);
    assert_eq!(value["target_surface_locator"], SURFACE);
    assert_eq!(value["submitted"], true);
    assert_eq!(value["verification_method"], "read_screen");
    assert_eq!(value["observed_processing_state"], "DELIVERED_ACKED");
    assert_eq!(value["sender_role"], "EXEC PM");
    assert!(value["timestamp"]
        .as_str()
        .is_some_and(|t| t.ends_with('Z') && t.len() == 20));
    assert!(value["polls"].as_u64().unwrap_or(0) >= 1);
    assert!(value["waited_ms"].is_u64());
    assert_eq!(value["harness"], "codex");
    assert_eq!(value["harness_source"], "detected");
    assert_eq!(value["queued"], false);
}

#[test]
fn a_refusal_record_is_a_send_refusal_and_never_a_delivery() {
    let dir = tempdir().expect("tmp");
    let path = dir.path().join("proof.jsonl");
    let outcome = deliver_against(&[screen!("permission_prompt")], "hello");
    let value = write_and_parse(&path, &outcome, "EXEC PM");

    assert_eq!(value["record_kind"], RECORD_KIND_SEND_REFUSAL);
    assert_eq!(value["submitted"], false);
    assert_eq!(
        value["observed_processing_state"],
        "PANE_BLOCKED_ON_PERMISSION"
    );
    assert_eq!(value["harness"], "unknown");
    assert_eq!(value["harness_source"], "unknown");
}

#[test]
fn a_still_thinking_refusal_records_waited_ms_and_polls() {
    let dir = tempdir().expect("tmp");
    let path = dir.path().join("proof.jsonl");
    let cmux = StubCmux::new(&[screen!("codex_busy")]);
    let clock = FakeClock::new();
    let outcome = deliver(
        &cmux,
        &clock,
        PaneRules::embedded(),
        &HarnessSelector::default(),
        SURFACE,
        "too soon",
        &DeliveryOptions {
            poll: Duration::from_secs(5),
            wait: Duration::from_secs(20),
        },
    );
    let value = write_and_parse(&path, &outcome, "EXEC PM");
    assert_eq!(value["record_kind"], RECORD_KIND_SEND_REFUSAL);
    assert_eq!(value["submitted"], false);
    assert_eq!(value["observed_processing_state"], "PANE_STILL_THINKING");
    assert_eq!(value["polls"], 5);
    assert!(value["waited_ms"].as_u64().unwrap_or(0) >= 20_000);
}

#[test]
fn the_log_is_append_only_and_its_directory_is_created_on_first_write() {
    let dir = tempdir().expect("tmp");
    let path = dir.path().join("state").join("odin").join("proof.jsonl");
    assert!(!path.exists());
    let delivered = deliver_against(&[screen!("codex_idle"), screen!("codex_idle")], "one");
    let refused = deliver_against(&[screen!("permission_prompt")], "two");
    proof::append(
        &path,
        &ProofEntry::for_outcome("say", SURFACE, &delivered, "EXEC PM", NOW.into()),
    )
    .expect("first append creates the directory");
    proof::append(
        &path,
        &ProofEntry::for_outcome("say", SURFACE, &refused, "EXEC PM", NOW.into()),
    )
    .expect("second append");
    let text = std::fs::read_to_string(&path).expect("log");
    let kinds: Vec<String> = text
        .lines()
        .map(|line| {
            serde_json::from_str::<serde_json::Value>(line).expect("json")["record_kind"]
                .as_str()
                .expect("record_kind")
                .to_string()
        })
        .collect();
    assert_eq!(kinds, vec![RECORD_KIND_DELIVERY, RECORD_KIND_SEND_REFUSAL]);
}

fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: Vec<(String, String)> = pairs
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();
    move |key: &str| map.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
}

#[test]
fn the_proof_path_comes_from_flag_then_environment_then_the_xdg_default() {
    let dir = tempdir().expect("tmp");
    let flag_path = dir.path().join("flag.jsonl");
    let env_path = dir.path().join("env.jsonl");
    let state = dir.path().join("state");

    let flag = Config::resolve(
        &ConfigFlags {
            proof: Some(flag_path.clone()),
            ..Default::default()
        },
        &env_of(&[
            ("ODIN_SAY_PROOF", &env_path.to_string_lossy()),
            ("XDG_STATE_HOME", &state.to_string_lossy()),
        ]),
    );
    assert_eq!(flag.proof_path, flag_path);

    let env = Config::resolve(
        &ConfigFlags::default(),
        &env_of(&[
            ("ODIN_SAY_PROOF", &env_path.to_string_lossy()),
            ("XDG_STATE_HOME", &state.to_string_lossy()),
        ]),
    );
    assert_eq!(env.proof_path, env_path);

    let default = Config::resolve(
        &ConfigFlags::default(),
        &env_of(&[("XDG_STATE_HOME", &state.to_string_lossy())]),
    );
    assert_eq!(
        default.proof_path,
        PathBuf::from(&state)
            .join("odin")
            .join("delivery-proof.jsonl")
    );
}

#[test]
fn the_sender_role_comes_from_flag_then_environment_then_the_default_role() {
    let env = env_of(&[("ODIN_SAY_SENDER_ROLE", "ENV PM")]);
    let flag = Config::resolve(
        &ConfigFlags {
            sender_role: Some("FLAG PM".into()),
            ..Default::default()
        },
        &env,
    );
    assert_eq!(flag.sender_role, "FLAG PM");
    let from_env = Config::resolve(&ConfigFlags::default(), &env);
    assert_eq!(from_env.sender_role, "ENV PM");
    let fallback = Config::resolve(&ConfigFlags::default(), &env_of(&[]));
    assert_eq!(fallback.sender_role, "EXEC PM");
}

#[test]
fn the_no_home_path_story_holds_when_the_environment_is_bare() {
    // Neither XDG_STATE_HOME nor HOME: a relative path, never a baked-in home directory.
    let config = Config::resolve(&ConfigFlags::default(), &env_of(&[]));
    assert_eq!(
        config.proof_path,
        PathBuf::from("odin").join("delivery-proof.jsonl")
    );
    assert!(!config.proof_path.to_string_lossy().starts_with('/'));
}

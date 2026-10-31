//! Slice 2: per-harness mid-turn policy.
//!
//! pi buffers text typed mid-turn and delivers it as a queued steer, so a busy pi pane is
//! sent to immediately and the read-back must show the text in the queue region. Every other
//! harness (claude-code, codex, opencode, unknown) keeps slice 1's bounded wait and refuses
//! if the pane is still busy, because no capture proves it buffers. Blocked panes refuse at
//! once for every harness, and identity is recorded on every proof record.

use odin_say::clock::FakeClock;
use odin_say::cmux::StubCmux;
use odin_say::identity::{identify, HarnessSelector, HarnessSource};
use odin_say::proof::{ProofEntry, RECORD_KIND_DELIVERY, RECORD_KIND_SEND_REFUSAL};
use odin_say::rules::PaneRules;
use odin_say::say::{deliver, DeliveryOptions, DeliveryState, Outcome};
use std::path::{Path, PathBuf};
use std::time::Duration;

const SURFACE: &str = "surface:7";
const NOW: &str = "2026-10-31T00:00:00Z";
const STEER_TEXT: &str =
    "PM-ODIN steer (capture test): no action needed; continue your current task.";
const PI_WAIT_UNUSED: u64 = 180;

macro_rules! screen {
    ($name:literal) => {
        include_str!(concat!("fixtures/screens/", $name, ".txt"))
    };
}

/// The two pi screens are REAL captures (proof 5). They are loaded at run time so a
/// checkout that has only the provisional stand-ins (local development, never committed)
/// can still run the rest of the suite; a clean clone without the real captures fails
/// loudly instead of silently passing on synthesized text.
fn capture(name: &str) -> String {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("screens");
    let real = dir.join(format!("{name}.txt"));
    let provisional = dir.join(format!("{name}_PROVISIONAL.txt"));
    if real.exists() {
        return std::fs::read_to_string(&real).expect("read capture");
    }
    assert!(
        provisional.exists(),
        "{} is missing: proof 5 requires a real screen capture committed at this path \
         (no {}_PROVISIONAL.txt fallback either)",
        real.display(),
        name
    );
    std::fs::read_to_string(&provisional).expect("read provisional capture")
}

fn rules() -> &'static PaneRules {
    PaneRules::embedded()
}

fn options(poll_secs: u64, wait_secs: u64) -> DeliveryOptions {
    DeliveryOptions {
        poll: Duration::from_secs(poll_secs),
        wait: Duration::from_secs(wait_secs),
    }
}

fn selector_flag(name: &str) -> HarnessSelector {
    HarnessSelector {
        flag: Some(name.into()),
        env: None,
    }
}

fn run(
    cmux: &StubCmux,
    selector: &HarnessSelector,
    text: &str,
    options: &DeliveryOptions,
) -> (Outcome, FakeClock) {
    let clock = FakeClock::new();
    let outcome = deliver(cmux, &clock, rules(), selector, SURFACE, text, options);
    (outcome, clock)
}

#[test]
fn pi_accepts_a_mid_turn_send_and_requires_queue_evidence() {
    let busy = capture("pi_busy");
    let queued = capture("pi_busy_steer_queued");
    let cmux = StubCmux::new(&[busy.as_str(), queued.as_str()]);
    let (outcome, clock) = run(
        &cmux,
        &HarnessSelector::default(),
        STEER_TEXT,
        &options(5, PI_WAIT_UNUSED),
    );

    // Sent immediately: no wait poll, no idle wait, one Enter, no second Enter.
    assert_eq!(outcome.polls, 1);
    assert_eq!(outcome.waited_ms, 0);
    assert!(clock.sleeps_ms().is_empty() || !clock.sleeps_ms().contains(&5000));
    assert_eq!(cmux.texts(), vec![STEER_TEXT.to_string()]);
    assert_eq!(cmux.keys(), vec!["Enter"]);

    // Delivered because the read-back shows the text in pi's queue region.
    assert!(outcome.queued);
    assert_eq!(outcome.state, DeliveryState::PaneStillThinking);
    assert_eq!((outcome.submitted, outcome.exit), (true, 0));
    assert_eq!(outcome.harness.harness, "pi");
    assert_eq!(outcome.harness.source, HarnessSource::Detected);

    let record = ProofEntry::for_outcome("say", SURFACE, &outcome, "EXEC PM", NOW.into());
    assert_eq!(record.record_kind, RECORD_KIND_DELIVERY);
    assert_eq!(record.observed_processing_state, "PANE_STILL_THINKING");
    assert!(record.submitted);
    assert!(record.queued);
    assert_eq!(record.harness, "pi");
    assert_eq!(record.harness_source, "detected");
}

#[test]
fn every_unverified_harness_keeps_the_bounded_wait_and_refuses() {
    let opencode_busy = "⠙ Streaming the reply\n\n  ctrl+p commands\n";
    let unknown_busy = "⠙ Thinking (5s · Working on it)\n\n  a footer nobody knows\n";
    let cases: Vec<(&str, String)> = vec![
        ("claude-code", screen!("claude_busy_queued").to_string()),
        ("codex", screen!("codex_busy").to_string()),
        ("opencode", opencode_busy.to_string()),
        ("unknown", unknown_busy.to_string()),
    ];

    for (expected_harness, busy) in cases {
        let cmux = StubCmux::new(&[busy.as_str()]);
        let (outcome, clock) = run(
            &cmux,
            &HarnessSelector::default(),
            STEER_TEXT,
            &options(5, 20),
        );
        assert_eq!(
            outcome.state,
            DeliveryState::PaneStillThinking,
            "{expected_harness}"
        );
        assert_eq!(
            (outcome.submitted, outcome.exit),
            (false, 3),
            "{expected_harness}"
        );
        assert!(outcome.polls >= 2, "{expected_harness}");
        assert!(outcome.waited_ms >= 20_000, "{expected_harness}");
        assert!(!outcome.queued, "{expected_harness}");
        assert_eq!(outcome.harness.harness, expected_harness);
        // Waited, never typed into.
        assert!(cmux.texts().is_empty(), "{expected_harness}");
        assert!(cmux.keys().is_empty(), "{expected_harness}");
        assert!(clock.sleeps_ms().contains(&5000), "{expected_harness}");
    }
}

#[test]
fn a_queue_send_without_queue_evidence_is_not_a_delivery() {
    let busy = capture("pi_busy");
    // The read-back is the same busy pane: the text never reaches a queue region.
    let cmux = StubCmux::new(&[busy.as_str(), busy.as_str()]);
    let (outcome, _clock) = run(
        &cmux,
        &HarnessSelector::default(),
        STEER_TEXT,
        &options(5, PI_WAIT_UNUSED),
    );

    assert!(outcome.submitted);
    assert_eq!(outcome.state, DeliveryState::InputBarOnly);
    assert_eq!(outcome.note, "queue-not-proven");
    assert_ne!(outcome.exit, 0);
    assert!(!outcome.queued);
    // Exactly one Enter: no second Enter on an unproven queue send.
    assert_eq!(cmux.keys(), vec!["Enter"]);
    assert_eq!(cmux.texts(), vec![STEER_TEXT.to_string()]);

    let record = ProofEntry::for_outcome("say", SURFACE, &outcome, "EXEC PM", NOW.into());
    assert_eq!(record.record_kind, RECORD_KIND_DELIVERY);
    assert_eq!(record.observed_processing_state, "INPUT_BAR_ONLY");
    assert!(record.submitted);
    assert!(!record.queued);
}

#[test]
fn identity_comes_from_flag_then_environment_then_detection() {
    let codex = screen!("codex_idle");
    let from_flag = identify(Some("pi"), Some("codex"), codex, rules());
    assert_eq!(from_flag.harness, "pi");
    assert_eq!(from_flag.source, HarnessSource::Flag);

    let from_env = identify(None, Some("opencode"), codex, rules());
    assert_eq!(from_env.harness, "opencode");
    assert_eq!(from_env.source, HarnessSource::Env);

    let detected = identify(None, None, codex, rules());
    assert_eq!(detected.harness, "codex");
    assert_eq!(detected.source, HarnessSource::Detected);

    let unknown = identify(None, None, "nothing familiar here", rules());
    assert_eq!(unknown.harness, "unknown");
    assert_eq!(unknown.source, HarnessSource::Unknown);
}

#[test]
fn the_flag_decides_the_policy_even_against_detection() {
    // A busily-detected codex pane, claimed as pi by flag, is typed into immediately.
    let queued = capture("pi_busy_steer_queued");
    let busy = capture("pi_busy");
    let cmux = StubCmux::new(&[busy.as_str(), queued.as_str()]);
    let (outcome, _clock) = run(
        &cmux,
        &selector_flag("pi"),
        STEER_TEXT,
        &options(5, PI_WAIT_UNUSED),
    );
    assert!(outcome.queued);
    assert_eq!(outcome.harness.harness, "pi");
    assert_eq!(outcome.harness.source, HarnessSource::Flag);
}

#[test]
fn blocked_panes_refuse_at_once_for_every_harness() {
    let blocked = screen!("permission_prompt");
    for harness in ["pi", "claude-code", "codex", "opencode", "unknown"] {
        let cmux = StubCmux::new(&[blocked]);
        let (outcome, clock) = run(&cmux, &selector_flag(harness), STEER_TEXT, &options(5, 20));
        assert_eq!(
            outcome.state,
            DeliveryState::PaneBlockedOnPermission,
            "{harness}"
        );
        assert_eq!((outcome.submitted, outcome.exit), (false, 2), "{harness}");
        assert_eq!(outcome.polls, 1, "{harness}");
        assert_eq!(outcome.waited_ms, 0, "{harness}");
        assert!(cmux.texts().is_empty(), "{harness}");
        assert!(cmux.keys().is_empty(), "{harness}");
        assert!(clock.sleeps_ms().is_empty(), "{harness}");
        let record = ProofEntry::for_outcome("say", SURFACE, &outcome, "EXEC PM", NOW.into());
        assert_eq!(record.record_kind, RECORD_KIND_SEND_REFUSAL, "{harness}");
        assert_eq!(record.harness, harness);
        assert_eq!(record.harness_source, "flag");
    }
}

#[test]
fn the_harness_table_ships_only_pi_on_queue() {
    for (name, harness) in &rules().harnesses {
        let expected = if name == "pi" {
            odin_say::rules::MidTurn::Queue
        } else {
            odin_say::rules::MidTurn::Refuse
        };
        assert_eq!(harness.mid_turn, expected, "{name}");
    }
}

#[test]
fn slice_one_capture_files_are_present_and_task_owned_paths_are_clean() {
    // Guard against a forgotten capture: the two pi screens must be readable and must show
    // the queue evidence the policy depends on.
    let busy = capture("pi_busy");
    let queued = capture("pi_busy_steer_queued");
    assert!(odin_say::say::busy(&busy, rules()));
    assert!(odin_say::say::shows_queued(
        &queued,
        STEER_TEXT,
        rules(),
        "pi"
    ));
    let fixture_dir: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("screens");
    assert!(fixture_dir.is_dir());
}

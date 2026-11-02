//! SLICE odin-say-seat-capped. Three real captures of agent seats stopped by a provider's
//! free-tier daily cap: the cap error sits in the newest output block, above the input bar and
//! footer chrome, and nothing is typed into such a seat. The captures are sanitized (paths,
//! seat names and ids replaced; cap lines verbatim); the stale-cap and busy fixtures are
//! constructed from the first capture and labelled as such.

use odin_say::clock::FakeClock;
use odin_say::cmux::{Call, StubCmux};
use odin_say::identity::HarnessSelector;
use odin_say::rules::PaneRules;
use odin_say::say::{capped, classify, deliver, DeliveryOptions, DeliveryState, PaneState};
use std::time::Duration;

macro_rules! screen {
    ($name:literal) => {
        include_str!(concat!("fixtures/screens/", $name, ".txt"))
    };
}

const SURFACE: &str = "surface:7";

fn options() -> DeliveryOptions {
    DeliveryOptions {
        poll: Duration::from_secs(5),
        wait: Duration::from_secs(180),
    }
}

const CAPTURES: [(&str, &str); 3] = [
    ("seat_capped_reset", screen!("seat_capped_reset")),
    ("seat_capped_box", screen!("seat_capped_box")),
    (
        "seat_capped_footer_thinking",
        screen!("seat_capped_footer_thinking"),
    ),
];

#[test]
fn r1_each_real_capture_is_capped() {
    for (name, text) in CAPTURES {
        assert_eq!(
            classify(text, PaneRules::embedded()),
            PaneState::Capped,
            "{name}"
        );
        assert!(capped(text, PaneRules::embedded()).is_some(), "{name}");
    }
}

#[test]
fn r1_reset_instant_comes_from_the_header_and_is_never_guessed() {
    let rules = PaneRules::embedded();
    let with_header = capped(screen!("seat_capped_reset"), rules).expect("capped");
    assert_eq!(
        with_header.reset_at.as_deref(),
        Some("2026-11-03T00:00:00Z")
    );
    assert_eq!(with_header.marker, "free_models_per_day");

    for (name, text) in [
        ("seat_capped_box", screen!("seat_capped_box")),
        (
            "seat_capped_footer_thinking",
            screen!("seat_capped_footer_thinking"),
        ),
    ] {
        let hit = capped(text, rules).unwrap_or_else(|| panic!("{name} is capped"));
        assert_eq!(hit.reset_at, None, "{name}");
    }
}

#[test]
fn r2_a_cap_followed_by_later_output_is_stale() {
    // CONSTRUCTED: the first real capture with a later turn response after the cap block.
    let text = screen!("seat_capped_stale");
    assert_ne!(classify(text, PaneRules::embedded()), PaneState::Capped);
    assert_eq!(capped(text, PaneRules::embedded()), None);
}

#[test]
fn r2_a_busy_pane_with_an_old_cap_line_is_busy_not_capped() {
    // CONSTRUCTED: the first real capture with a live spinner status line after the cap block.
    let text = screen!("seat_capped_busy");
    // Precedence is blocked, busy, capped: a working pane is busy, not capped, even though the
    // raw cap detector still sees the cap block in its scrollback.
    assert_eq!(classify(text, PaneRules::embedded()), PaneState::Busy);
}

#[test]
fn r2_existing_pane_fixtures_keep_their_verdicts_and_none_is_capped() {
    let rules = PaneRules::embedded();
    let table: [(&str, &str, PaneState); 8] = [
        ("codex_idle", screen!("codex_idle"), PaneState::Idle),
        ("codex_busy", screen!("codex_busy"), PaneState::Busy),
        (
            "codex_stale_input",
            screen!("codex_stale_input"),
            PaneState::StaleInput,
        ),
        (
            "permission_prompt",
            screen!("permission_prompt"),
            PaneState::Blocked,
        ),
        (
            "claude_busy_queued",
            screen!("claude_busy_queued"),
            PaneState::Busy,
        ),
        ("claude_idle", screen!("claude_idle"), PaneState::Idle),
        (
            "opencode_overlay",
            screen!("opencode_overlay"),
            PaneState::Blocked,
        ),
        ("spinner_only", screen!("spinner_only"), PaneState::Busy),
    ];
    for (name, text, want) in table {
        assert_eq!(classify(text, rules), want, "{name}");
        assert_ne!(classify(text, rules), PaneState::Capped, "{name}");
    }
}

#[test]
fn r3_say_refuses_a_capped_seat_before_typing_anything() {
    let cmux = StubCmux::new(&[screen!("seat_capped_reset")]);
    let clock = FakeClock::new();
    let outcome = deliver(
        &cmux,
        &clock,
        PaneRules::embedded(),
        &HarnessSelector::default(),
        SURFACE,
        "run the gate",
        &options(),
    );

    assert_eq!(outcome.state, DeliveryState::SeatCapped);
    assert!(!outcome.submitted);
    assert_eq!((outcome.note, outcome.exit), ("seat-capped", 10));
    assert_eq!(outcome.polls, 1);
    assert_eq!(outcome.waited_ms, 0);
    assert_eq!(outcome.cap_marker.as_deref(), Some("free_models_per_day"));
    assert_eq!(outcome.reset_at.as_deref(), Some("2026-11-03T00:00:00Z"));

    // Nothing typed, nothing waited for: the stub saw reads only.
    let calls = cmux.recorded();
    assert!(calls.iter().all(|call| matches!(call, Call::ReadScreen(_))));
    assert!(cmux.texts().is_empty());
    assert!(cmux.keys().is_empty());
    assert!(clock.sleeps_ms().is_empty());
}

#[test]
fn r3_a_capped_seat_is_refused_before_a_busy_wait() {
    // Precedence is blocked, busy, capped: a pane that is working is not capped, so a busy
    // fixture is waited on, never refused as SEAT_CAPPED.
    let cmux = StubCmux::new(&[screen!("seat_capped_busy")]);
    let clock = FakeClock::new();
    // Force a refuse-policy harness so the busy wait (not the pi queue path) is exercised.
    let refuse_policy = HarnessSelector {
        flag: Some("codex".into()),
        env: None,
    };
    let outcome = deliver(
        &cmux,
        &clock,
        PaneRules::embedded(),
        &refuse_policy,
        SURFACE,
        "run the gate",
        &DeliveryOptions {
            poll: Duration::from_secs(5),
            wait: Duration::from_secs(10),
        },
    );
    assert_eq!(outcome.state, DeliveryState::PaneStillThinking);
    assert_ne!(outcome.state, DeliveryState::SeatCapped);
    assert_ne!(outcome.exit, 10);
    assert_eq!(outcome.waited_ms, 10_000);
}

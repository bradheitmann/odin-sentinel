//! Screen classification from the fixture corpus, and the `say` decision procedure driven
//! through a scripted [`StubCmux`] and a [`FakeClock`] (no pane is touched, no real sleep).

use odin_say::clock::FakeClock;
use odin_say::cmux::StubCmux;
use odin_say::identity::{identify, HarnessSelector};
use odin_say::rules::PaneRules;
use odin_say::say::{
    answered, blocked, busy, classify, deliver, input_bar, stale_input, DeliveryOptions,
    DeliveryState, Outcome, PaneState,
};
use std::time::Duration;

macro_rules! screen {
    ($name:literal) => {
        include_str!(concat!("fixtures/screens/", $name, ".txt"))
    };
}

const SURFACE: &str = "surface:7";

fn rules() -> &'static PaneRules {
    PaneRules::embedded()
}

fn options(poll_secs: u64, wait_secs: u64) -> DeliveryOptions {
    DeliveryOptions {
        poll: Duration::from_secs(poll_secs),
        wait: Duration::from_secs(wait_secs),
    }
}

fn run(cmux: &StubCmux, text: &str) -> (Outcome, FakeClock) {
    let clock = FakeClock::new();
    let out = deliver(
        cmux,
        &clock,
        rules(),
        &HarnessSelector::default(),
        SURFACE,
        text,
        &options(5, 180),
    );
    (out, clock)
}

#[test]
fn every_exported_screen_fixture_classifies_to_its_typed_state() {
    let table: [(&str, &str, PaneState); 11] = [
        ("claude_idle", screen!("claude_idle"), PaneState::Idle),
        ("claude_busy", screen!("claude_busy"), PaneState::Busy),
        (
            "claude_busy_queued",
            screen!("claude_busy_queued"),
            PaneState::Busy,
        ),
        ("codex_idle", screen!("codex_idle"), PaneState::Idle),
        (
            "codex_stale_input",
            screen!("codex_stale_input"),
            PaneState::StaleInput,
        ),
        ("codex_busy", screen!("codex_busy"), PaneState::Busy),
        (
            "codex_acked_after_send",
            screen!("codex_acked_after_send"),
            PaneState::Idle,
        ),
        (
            "permission_prompt",
            screen!("permission_prompt"),
            PaneState::Blocked,
        ),
        (
            "opencode_overlay",
            screen!("opencode_overlay"),
            PaneState::Blocked,
        ),
        ("spinner_only", screen!("spinner_only"), PaneState::Busy),
        (
            "ambient_bypass_not_blocked",
            screen!("ambient_bypass_not_blocked"),
            PaneState::Idle,
        ),
    ];
    for (name, text, want) in table {
        assert_eq!(classify(text, rules()), want, "fixture {name}");
    }
}

#[test]
fn an_idle_pane_with_leftover_thinking_scrollback_is_idle() {
    // Synthesized fixture: an idle OpenCode pane whose scrollback still holds a "Thinking:"
    // line above the prompt. The old rule matched busy words anywhere in the 14-line tail
    // and refused this pane as PANE_STILL_THINKING; only live lines may mark a pane busy.
    let text = screen!("opencode_thinking_scrollback");
    assert_eq!(classify(text, rules()), PaneState::Idle);
    assert!(!busy(text, rules()));

    let cmux = StubCmux::new(&[text, screen!("codex_acked_after_send")]);
    let (out, _clock) = run(&cmux, "run the gate on branch feat-x please");
    assert_eq!(out.state.as_str(), "DELIVERED_ACKED");
    assert_eq!(out.exit, 0);
}

#[test]
fn claude_code_panes_are_recognised() {
    assert_eq!(
        identify(None, None, screen!("claude_idle"), rules()).harness,
        "claude-code"
    );
    assert_eq!(
        identify(None, None, screen!("claude_busy"), rules()).harness,
        "claude-code"
    );
    assert_eq!(
        identify(None, None, screen!("codex_idle"), rules()).harness,
        "codex"
    );
}

#[test]
fn only_the_last_prompt_line_is_the_input_bar() {
    let bar = input_bar(screen!("codex_stale_input")).expect("bar");
    assert_eq!(bar, "› half typed text left in the bar");
    assert!(!stale_input(screen!("codex_acked_after_send")));
    assert!(!stale_input(screen!("codex_idle")));
    assert!(stale_input(screen!("codex_stale_input")));
    assert!(!stale_input("›  \n"));
}

#[test]
fn the_ambient_bypass_line_never_blocks_but_a_real_prompt_does() {
    assert!(!blocked(screen!("ambient_bypass_not_blocked"), rules()));
    assert!(blocked(screen!("permission_prompt"), rules()));
    assert!(!busy(screen!("claude_idle"), rules()));
}

#[test]
fn answered_reads_the_fixture_after_the_echo() {
    assert!(answered(
        screen!("codex_acked_after_send"),
        "run the gate on branch feat-x"
    ));
    assert!(!answered(screen!("codex_idle"), "run the gate"));
}

fn bar_with(text: &str) -> String {
    format!("› {text}\n")
}

#[test]
fn happy_path_sends_one_flat_line_and_exactly_one_enter() {
    let cmux = StubCmux::new(&[screen!("codex_idle"), screen!("codex_acked_after_send")]);
    let (out, _clock) = run(&cmux, "run the gate\non branch feat-x\tplease");
    assert_eq!(out.state, DeliveryState::DeliveredAcked);
    assert_eq!((out.submitted, out.note, out.exit), (true, "echoed", 0));
    assert_eq!(cmux.texts(), vec!["run the gate on branch feat-x please"]);
    assert_eq!(cmux.keys(), vec!["Enter"]);
}

#[test]
fn processing_after_enter_is_delivered_no_ack() {
    let cmux = StubCmux::new(&[screen!("codex_idle"), screen!("codex_busy")]);
    let (out, _clock) = run(&cmux, "hello there");
    assert_eq!(out.state, DeliveryState::DeliveredNoAck);
    assert_eq!(out.note, "processing");
    assert_eq!(out.exit, 0);
}

#[test]
fn a_cleared_prompt_without_echo_is_delivered_no_ack() {
    let cmux = StubCmux::new(&[screen!("codex_idle"), screen!("codex_idle")]);
    let (out, _clock) = run(&cmux, "nothing echoed");
    assert_eq!(out.state, DeliveryState::DeliveredNoAck);
    assert_eq!(out.note, "prompt-clear");
}

#[test]
fn a_permission_prompt_refuses_at_once_before_anything_is_sent() {
    let cmux = StubCmux::new(&[screen!("permission_prompt")]);
    let (out, clock) = run(&cmux, "hello");
    assert_eq!(out.state, DeliveryState::PaneBlockedOnPermission);
    assert_eq!((out.submitted, out.exit), (false, 2));
    assert_eq!(out.polls, 1);
    assert_eq!(out.waited_ms, 0);
    assert!(clock.sleeps_ms().is_empty());
    assert!(cmux.texts().is_empty());
    assert!(cmux.keys().is_empty());
}

#[test]
fn the_dismissible_overlay_gets_one_escape_then_proceeds() {
    let cmux = StubCmux::new(&[
        screen!("opencode_overlay"),
        screen!("codex_idle"),
        screen!("codex_idle"),
    ]);
    let (out, _clock) = run(&cmux, "after the overlay");
    assert_eq!(cmux.keys(), vec!["Escape", "Enter"]);
    assert!(out.state.delivered());
}

#[test]
fn a_pane_busy_past_the_wait_budget_is_refused_with_polls_and_waited_ms() {
    let cmux = StubCmux::new(&[screen!("codex_busy")]);
    let clock = FakeClock::new();
    let out = deliver(
        &cmux,
        &clock,
        rules(),
        &HarnessSelector::default(),
        SURFACE,
        "too soon",
        &options(5, 25),
    );
    assert_eq!(out.state, DeliveryState::PaneStillThinking);
    assert_eq!((out.submitted, out.exit), (false, 3));
    // 25 s budget at a 5 s poll: initial read + 5 polls.
    assert_eq!(out.polls, 6);
    assert!(out.waited_ms >= 25_000);
    assert_eq!(clock.sleeps_ms(), vec![5000, 5000, 5000, 5000, 5000]);
    assert!(cmux.texts().is_empty());
    assert!(cmux.keys().is_empty());
}

#[test]
fn a_pane_busy_for_two_polls_then_idle_is_delivered() {
    let cmux = StubCmux::new(&[
        screen!("codex_busy"),
        screen!("codex_busy"),
        screen!("codex_idle"),
        screen!("codex_acked_after_send"),
    ]);
    let clock = FakeClock::new();
    let out = deliver(
        &cmux,
        &clock,
        rules(),
        &HarnessSelector::default(),
        SURFACE,
        "run the gate on branch feat-x please",
        &options(5, 180),
    );
    assert!(out.state.delivered(), "{:?}", out.state);
    assert_eq!(out.polls, 3);
    assert_eq!(out.waited_ms, 10_000);
}

#[test]
fn a_busy_claude_code_pane_queues_on_captured_evidence() {
    // Captured 2026-11-10: a message typed mid-turn appears on a prompt line and the bar
    // reads "Press up to edit queued messages" on a LATER line.
    let cmux = StubCmux::new(&[
        screen!("claude_busy_self"),
        screen!("claude_busy_queued_capture"),
    ]);
    let (out, _clock) = run(
        &cmux,
        "ODIN-SELFTEST queued capture probe from PM-ODIN to its own pane: ignore this line",
    );
    assert_eq!(out.state, DeliveryState::PaneStillThinking);
    assert_eq!((out.submitted, out.queued, out.exit), (true, true, 0));
    assert_eq!(out.note, "queued");
}

#[test]
fn a_claude_code_queue_without_the_evidence_marker_is_not_proven() {
    let queued_without_marker = screen!("claude_busy_queued_capture")
        .replace("Press up to edit queued messages", "an unrelated line");
    let cmux = StubCmux::new(&[screen!("claude_busy_self"), queued_without_marker.as_str()]);
    let (out, _clock) = run(&cmux, "a queued line with no evidence");
    assert_eq!(out.state, DeliveryState::InputBarOnly);
    assert_eq!((out.submitted, out.exit), (true, 7));
    assert_eq!(out.note, "queue-not-proven");
    // No second Enter for an unproven queue send.
    assert_eq!(cmux.keys(), vec!["Enter"]);
}

#[test]
fn the_subagent_selector_below_the_footer_is_not_stale_input() {
    // Captured 2026-11-10: the prompt-glyph line below the footer is the sub-agent selector.
    // It must never be read as text stuck in the bar, and never get an Enter before the send.
    let cmux = StubCmux::new(&[screen!("claude_subagent_selector"), screen!("claude_idle")]);
    let (out, _clock) = run(&cmux, "after the selector");
    assert!(!stale_input(screen!("claude_subagent_selector")));
    assert!(out.state.delivered(), "{:?}", out.state);
    // One Enter, for the send itself: the selector line was not "cleared".
    assert_eq!(cmux.keys(), vec!["Enter"]);
}

#[test]
fn a_failed_send_is_send_failed_with_the_transport_error() {
    let cmux = StubCmux::new(&[screen!("codex_idle")]).failing_with("exit 1: sync lost");
    let (out, _clock) = run(&cmux, "x");
    assert_eq!(out.state, DeliveryState::SendFailed);
    assert_eq!((out.note, out.exit), ("send-failed", 5));
    assert_eq!(out.transport_error.as_deref(), Some("exit 1: sync lost"));
    assert!(cmux.keys().is_empty(), "no key may follow a failed send");
}

#[test]
fn a_failed_enter_keeps_the_bar_state_and_names_the_key() {
    let cmux = StubCmux::new(&[screen!("codex_idle")]).failing_keys("exit 1: key refused");
    let (out, _clock) = run(&cmux, "x");
    assert_eq!(out.state, DeliveryState::InputBarOnly);
    assert_eq!((out.note, out.exit), ("enter-failed", 5));
    assert_eq!(out.transport_error.as_deref(), Some("exit 1: key refused"));
}

#[test]
fn stale_input_is_submitted_first_then_the_message_goes() {
    let cmux = StubCmux::new(&[
        screen!("codex_stale_input"),
        screen!("codex_idle"),
        screen!("codex_acked_after_send"),
    ]);
    let (out, _clock) = run(&cmux, "run the gate on branch feat-x please");
    assert_eq!(cmux.keys(), vec!["Enter", "Enter"]);
    assert_eq!(out.state, DeliveryState::DeliveredAcked);
}

#[test]
fn stale_input_that_will_not_submit_refuses_without_sending() {
    let cmux = StubCmux::new(&[screen!("codex_stale_input")]);
    let (out, _clock) = run(&cmux, "never sent");
    assert_eq!(out.state, DeliveryState::InputBarOnly);
    assert_eq!(
        (out.submitted, out.note, out.exit),
        (false, "stale-text-stuck", 4)
    );
    assert!(cmux.texts().is_empty());
}

#[test]
fn the_message_stuck_in_the_bar_gets_one_more_enter_then_refuses() {
    let stuck = bar_with("please run the gate");
    let cmux = StubCmux::new(&[screen!("codex_idle"), &stuck, &stuck]);
    let (out, _clock) = run(&cmux, "please run the gate");
    assert_eq!(out.state, DeliveryState::InputBarOnly);
    assert_eq!(
        (out.submitted, out.note, out.exit),
        (true, "after-2-enters", 6)
    );
    assert_eq!(cmux.keys(), vec!["Enter", "Enter"]);
}

#[test]
fn an_echo_with_a_response_after_it_is_delivered_not_stuck() {
    let echoed = "❯ please run the gate\n⏺ on it\n";
    let cmux = StubCmux::new(&[screen!("claude_idle"), echoed, echoed]);
    let (out, _clock) = run(&cmux, "please run the gate");
    assert_eq!(out.state, DeliveryState::DeliveredAcked);
    assert_eq!(cmux.keys(), vec!["Enter", "Enter"]);
}

#[test]
fn a_failed_send_is_input_bar_only_with_exit_five() {
    let cmux = StubCmux::new(&[screen!("codex_idle")]).failing();
    let (out, _clock) = run(&cmux, "x");
    assert_eq!(out.state, DeliveryState::SendFailed);
    assert_eq!((out.note, out.exit), ("send-failed", 5));
    assert!(cmux.keys().is_empty());
}

#[test]
fn only_delivered_states_exit_zero() {
    for state in [DeliveryState::DeliveredAcked, DeliveryState::DeliveredNoAck] {
        assert!(state.delivered());
    }
    for state in [
        DeliveryState::InputBarOnly,
        DeliveryState::PaneBlockedOnPermission,
        DeliveryState::PaneStillThinking,
    ] {
        assert!(!state.delivered());
    }
    assert_eq!(
        DeliveryState::PaneBlockedOnPermission.as_str(),
        "PANE_BLOCKED_ON_PERMISSION"
    );
}

// F-01: the blocked check must run again after every re-read, not only on the first read.
// A pane that turns into a permission prompt after the dismissible-overlay Escape, or during
// the busy wait, must be refused before anything is typed.

#[test]
fn a_permission_prompt_after_the_overlay_escape_is_refused_before_any_text() {
    let cmux = StubCmux::new(&[
        screen!("opencode_overlay"),
        screen!("permission_prompt"),
        screen!("permission_prompt"),
    ]);
    let (out, _clock) = run(&cmux, "do not type this");
    assert_eq!(out.state, DeliveryState::PaneBlockedOnPermission);
    assert_eq!((out.submitted, out.exit), (false, 2));
    assert!(
        cmux.texts().is_empty(),
        "no text may be sent to a blocked pane"
    );
    assert_eq!(
        cmux.keys(),
        vec!["Escape"],
        "only the overlay Escape is sent"
    );
}

#[test]
fn a_permission_prompt_appearing_during_the_busy_wait_is_refused_before_any_text() {
    let cmux = StubCmux::new(&[screen!("codex_busy"), screen!("permission_prompt")]);
    let (out, _clock) = run(&cmux, "do not type this");
    assert_eq!(out.state, DeliveryState::PaneBlockedOnPermission);
    assert_eq!((out.submitted, out.exit), (false, 2));
    assert!(
        cmux.texts().is_empty(),
        "no text may be sent to a blocked pane"
    );
    assert!(
        cmux.keys().is_empty(),
        "no key may be sent to a blocked pane"
    );
}

// F-02: a read-back that fails after the text was typed is a submitted attempt whose
// verification failed — never a delivery.
#[test]
fn a_failed_read_back_is_never_reported_as_delivered() {
    let cmux = StubCmux::new(&[screen!("codex_idle")]).with_read_failure_from(2);
    let (out, _clock) = run(&cmux, "hello");
    assert_eq!(out.state, DeliveryState::PaneReadFailed);
    assert_eq!(out.note, "read-back-failed");
    assert_eq!((out.submitted, out.exit), (true, 11));
    assert!(!out.state.delivered());
    // The text was typed once, so this is a submitted attempt, not a pre-send refusal.
    assert_eq!(cmux.texts(), vec!["hello".to_string()]);
}

#[test]
fn a_failed_first_read_refuses_with_nothing_typed() {
    let cmux = StubCmux::new(&[screen!("codex_idle")]).with_read_failure_from(1);
    let (out, clock) = run(&cmux, "hello");
    assert_eq!(out.state, DeliveryState::PaneReadFailed);
    assert_eq!(out.note, "read-failed");
    assert_eq!((out.submitted, out.exit), (false, 11));
    assert!(cmux.texts().is_empty());
    assert!(cmux.keys().is_empty());
    assert!(clock.sleeps_ms().is_empty());
}

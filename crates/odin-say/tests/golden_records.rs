//! Golden record corpus: the real sender flow, one record per outcome, committed as JSONL.
//!
//! The corpus is the cross-language contract with ODIN's TypeScript validator
//! (`odin.validate_cmux_delivery_proof`) and with the PlanGraph delivery-fact mapping. It is
//! produced here — not hand-written — and this test fails when the committed file drifts from
//! what the current code produces. Regenerate deliberately with `ODIN_SAY_REGEN_GOLDEN=1`.

use odin_say::clock::FakeClock;
use odin_say::cmux::StubCmux;
use odin_say::identity::HarnessSelector;
use odin_say::proof::ProofEntry;
use odin_say::rules::PaneRules;
use odin_say::say::{deliver, DeliveryOptions, Outcome};
use std::path::{Path, PathBuf};
use std::time::Duration;

const NOW: &str = "2026-10-31T00:00:00Z";
const SENDER_ROLE: &str = "EXEC PM";
const SURFACE: &str = "surface:7";
const GOLDEN_RELATIVE: &str = "tests/fixtures/records/golden.jsonl";

macro_rules! screen {
    ($name:literal) => {
        include_str!(concat!("fixtures/screens/", $name, ".txt"))
    };
}

fn options(poll_secs: u64, wait_secs: u64) -> DeliveryOptions {
    DeliveryOptions {
        poll: Duration::from_secs(poll_secs),
        wait: Duration::from_secs(wait_secs),
    }
}

fn deliver_against(screens: &[&str], text: &str, options: &DeliveryOptions) -> Outcome {
    let cmux = StubCmux::new(screens);
    let clock = FakeClock::new();
    deliver(
        &cmux,
        &clock,
        PaneRules::embedded(),
        &HarnessSelector::default(),
        SURFACE,
        text,
        options,
    )
}

/// Same flow, but the pane refuses the send (`send` / `send-key` fail): exits 5.
fn deliver_with_failing_pane(screens: &[&str], text: &str, options: &DeliveryOptions) -> Outcome {
    let cmux = StubCmux::new(screens).failing();
    let clock = FakeClock::new();
    deliver(
        &cmux,
        &clock,
        PaneRules::embedded(),
        &HarnessSelector::default(),
        SURFACE,
        text,
        options,
    )
}

fn bar_with(text: &str) -> String {
    format!("› {text}\n")
}

fn line(outcome: &Outcome) -> String {
    let entry = ProofEntry::for_outcome("say", SURFACE, outcome, SENDER_ROLE, NOW.to_string());
    serde_json::to_string(&entry).expect("record serializes")
}

/// One record per sender outcome, in a fixed order. Every input is deterministic (fixed
/// screens, fixed clock, fixed timestamp), so the corpus is reproducible.
fn golden_corpus() -> String {
    let records = [
        // 1. Delivered, acknowledged: the target echoed the message and responded.
        line(&deliver_against(
            &[screen!("codex_idle"), screen!("codex_acked_after_send")],
            "run the gate on branch feat-x please",
            &options(5, 180),
        )),
        // 2. Delivered, no acknowledgement yet: the target is processing.
        line(&deliver_against(
            &[screen!("codex_idle"), screen!("codex_busy")],
            "run the gate on branch feat-x please",
            &options(5, 180),
        )),
        // 3. Queued mid-turn on pi: sent while busy, read-back shows the steer queued.
        line(&deliver_against(
            &[screen!("pi_busy"), screen!("pi_busy_steer_queued")],
            "PM-ODIN steer (capture test): no action needed; continue your current task.",
            &options(5, 180),
        )),
        // 4. Busy refusal after the bounded wait: nothing was typed into the pane.
        line(&deliver_against(
            &[screen!("codex_busy")],
            "too soon",
            &options(5, 10),
        )),
        // 5. Blocked refusal: a permission prompt refuses at once.
        line(&deliver_against(
            &[screen!("permission_prompt")],
            "hello",
            &options(5, 180),
        )),
        // 6. Input-bar-only after a queue send whose read-back never showed the queue.
        line(&deliver_against(
            &[screen!("pi_busy"), screen!("pi_busy")],
            "PM-ODIN steer (capture test): no action needed; continue your current task.",
            &options(5, 180),
        )),
        // 7. Exit 4: stale text in the input bar would not submit; nothing was sent.
        line(&deliver_against(
            &[screen!("codex_stale_input")],
            "never sent",
            &options(5, 180),
        )),
        // 8. Exit 5, plain path: the pane refused the send itself.
        line(&deliver_with_failing_pane(
            &[screen!("codex_idle")],
            "x",
            &options(5, 180),
        )),
        // 9. Exit 5, queue path: a busy pi pane refused the mid-turn send.
        line(&deliver_with_failing_pane(
            &[screen!("pi_busy")],
            "PM-ODIN steer (capture test): no action needed; continue your current task.",
            &options(5, 180),
        )),
        // 10. Exit 6: the message stayed in the bar after the one allowed re-Enter.
        {
            let stuck = bar_with("please run the gate");
            let screens = [screen!("codex_idle"), stuck.as_str(), stuck.as_str()];
            line(&deliver_against(
                &screens,
                "please run the gate",
                &options(5, 180),
            ))
        },
    ];
    let mut text = records.join("\n");
    text.push('\n');
    text
}

fn golden_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(GOLDEN_RELATIVE)
}

#[test]
fn golden_corpus_is_live_and_reproducible() {
    let want = golden_corpus();
    let path = golden_path();
    let have = std::fs::read_to_string(&path).unwrap_or_default();

    if std::env::var("ODIN_SAY_REGEN_GOLDEN").as_deref() == Ok("1") {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create fixture directory");
        }
        std::fs::write(&path, &want).expect("write golden corpus");
        eprintln!("regenerated {}", path.display());
        return;
    }

    assert_eq!(
        have,
        want,
        "{} drifted from the current sender flow; review the change, then regenerate with \
         ODIN_SAY_REGEN_GOLDEN=1",
        path.display()
    );
}

#[test]
fn every_golden_record_parses_back_with_its_outcome_shape() {
    let text = std::fs::read_to_string(golden_path()).expect("committed golden corpus");
    let records: Vec<ProofEntry> = text
        .lines()
        .map(|line| serde_json::from_str(line).expect("golden line is a proof record"))
        .collect();
    assert_eq!(
        records.len(),
        10,
        "one record per recordable sender outcome"
    );

    let shapes: Vec<(&str, &str, bool, bool)> = records
        .iter()
        .map(|record| {
            (
                record.record_kind.as_str(),
                record.observed_processing_state.as_str(),
                record.submitted,
                record.queued,
            )
        })
        .collect();
    assert_eq!(
        shapes,
        vec![
            ("delivery", "DELIVERED_ACKED", true, false),
            ("delivery", "DELIVERED_NO_ACK", true, false),
            ("delivery", "PANE_STILL_THINKING", true, true),
            ("send_refusal", "PANE_STILL_THINKING", false, false),
            ("send_refusal", "PANE_BLOCKED_ON_PERMISSION", false, false),
            ("delivery", "INPUT_BAR_ONLY", true, false),
            ("send_refusal", "INPUT_BAR_ONLY", false, false),
            ("send_refusal", "INPUT_BAR_ONLY", false, false),
            ("send_refusal", "INPUT_BAR_ONLY", false, false),
            ("delivery", "INPUT_BAR_ONLY", true, false),
        ]
    );
    // Every record carries the six delivery-proof fields with the right types.
    for record in records {
        assert_eq!(record.target_surface_locator, SURFACE);
        assert_eq!(record.verification_method, "read_screen");
        assert_eq!(record.sender_role, SENDER_ROLE);
        assert_eq!(record.timestamp, NOW);
        assert!(!record.harness.is_empty());
        assert!(!record.harness_source.is_empty());
    }
}

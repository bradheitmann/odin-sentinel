//! Slice 3: proof-record integrity.
//!
//! A record is one buffered `write_all` on an O_APPEND handle, so concurrent senders
//! sharing one log cannot interleave a line; and `waited_ms` is monotonic WALL time from the
//! first busy observation to the decision, so screen-read time counts (not just sleeps).

use odin_say::clock::FakeClock;
use odin_say::cmux::StubCmux;
use odin_say::identity::HarnessSelector;
use odin_say::proof::{self, ProofEntry};
use odin_say::rules::PaneRules;
use odin_say::say::{deliver, DeliveryOptions, Outcome};
use std::collections::HashSet;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;
use tempfile::tempdir;

macro_rules! screen {
    ($name:literal) => {
        include_str!(concat!("fixtures/screens/", $name, ".txt"))
    };
}

const SURFACE: &str = "surface:7";

fn options(poll_secs: u64, wait_secs: u64) -> DeliveryOptions {
    DeliveryOptions {
        poll: Duration::from_secs(poll_secs),
        wait: Duration::from_secs(wait_secs),
    }
}

fn delivered_outcome() -> Outcome {
    let cmux = StubCmux::new(&[screen!("codex_idle"), screen!("codex_idle")]);
    let clock = FakeClock::new();
    deliver(
        &cmux,
        &clock,
        PaneRules::embedded(),
        &HarnessSelector::default(),
        SURFACE,
        "one line",
        &options(5, 180),
    )
}

#[test]
fn concurrent_senders_never_interleave_a_record() {
    let dir = tempdir().expect("tmp");
    let path = Arc::new(dir.path().join("proof.jsonl"));
    let outcome = delivered_outcome();
    const SENDERS: usize = 4;
    const RECORDS: usize = 200;

    std::thread::scope(|scope| {
        for sender in 0..SENDERS {
            let path = Arc::clone(&path);
            let outcome = outcome.clone();
            scope.spawn(move || {
                for record in 0..RECORDS {
                    let entry = ProofEntry::for_outcome(
                        &format!("sender-{sender}-{record}"),
                        SURFACE,
                        &outcome,
                        "EXEC PM",
                        "2026-10-31T00:00:00Z".into(),
                    );
                    proof::append(path.as_path(), &entry).expect("append");
                }
            });
        }
    });

    let text = std::fs::read_to_string(path.as_ref()).expect("log");
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), SENDERS * RECORDS, "one line per record");
    let mut seen = HashSet::new();
    for line in &lines {
        let value: serde_json::Value = serde_json::from_str(line).expect("intact JSON line");
        let subcommand = value["subcommand"]
            .as_str()
            .expect("subcommand")
            .to_string();
        assert!(seen.insert(subcommand), "duplicated or regenerated line");
    }
    assert_eq!(seen.len(), SENDERS * RECORDS);
}

#[test]
fn waited_ms_is_wall_time_so_screen_reads_count() {
    let clock = Rc::new(FakeClock::new());
    let read_cost = Duration::from_millis(300);
    // A busy pane that never goes idle: the refusal must report the wall time it took,
    // which is the sleeps PLUS the four 300 ms reads — not just the 20 000 ms of sleeps.
    let cmux = StubCmux::new(&[screen!("codex_busy")]).with_read_cost(Rc::clone(&clock), read_cost);

    let outcome = deliver(
        &cmux,
        clock.as_ref(),
        PaneRules::embedded(),
        &HarnessSelector::default(),
        SURFACE,
        "too soon",
        &options(5, 20),
    );

    // The poll sleeps are clamped to the remaining WALL budget, so their sum alone is under
    // the budget; the reads are what carry the total past it.
    let slept: u64 = clock.sleeps_ms().iter().sum();
    // The observation read happens before the first busy observation, so four poll reads
    // (300 ms each) are inside the measured window.
    let read_time: u64 = 4 * 300;
    assert_eq!(outcome.polls, 5, "initial read plus four polls");
    assert_eq!(slept, 19_100, "sleeps are clamped to the wall-time budget");
    assert!(slept < 20_000);
    assert!(
        outcome.waited_ms > slept,
        "waited_ms must include screen-read time: {} vs sleeps {}",
        outcome.waited_ms,
        slept
    );
    // The four poll reads are exactly the gap over the sleeps.
    assert_eq!(outcome.waited_ms, slept + read_time);
    assert!(
        outcome.waited_ms >= 20_000,
        "the budget was reached in wall time"
    );
    assert!(outcome.waited_ms - 20_000 <= 5_000, "within one poll");
}

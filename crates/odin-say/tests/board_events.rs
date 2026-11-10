//! Proof 3 (event-log): `board events` is ordered, typed, byte-identical across two runs, and
//! counts the proof lines it could not parse on stderr instead of dropping them silently.

use odin_say::board::{event_log, read_proof_log};

fn fixtures() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/board")
}

fn read(name: &str) -> String {
    std::fs::read_to_string(fixtures().join(name)).expect(name)
}

fn events() -> String {
    event_log(&read("board.md"), &read_proof_log(&read("proof.log"))).expect("events")
}

#[test]
fn two_runs_give_the_same_bytes() {
    assert_eq!(events(), events());
}

#[test]
fn every_line_is_typed_and_ordered_by_time() {
    let text = events();
    let mut previous: Option<String> = None;
    let mut kinds = std::collections::BTreeSet::new();
    for line in text.lines() {
        let value: serde_json::Value = serde_json::from_str(line).expect("json line");
        let kind = value["kind"].as_str().expect("kind").to_owned();
        kinds.insert(kind.clone());
        if let Some(timestamp) = value["timestamp"].as_str() {
            if let Some(previous) = &previous {
                assert!(
                    previous <= &timestamp.to_owned(),
                    "{previous} then {timestamp}"
                );
            }
            previous = Some(timestamp.to_owned());
        }
    }
    assert!(kinds.contains("board_line"), "{kinds:?}");
    assert!(kinds.contains("delivery"), "{kinds:?}");
    assert!(kinds.contains("board_line_unparsed"), "{kinds:?}");
}

#[test]
fn the_unparsed_proof_lines_are_counted_on_stderr() {
    let log = read_proof_log(&read("proof.log"));
    // [INFO] line and the hand-written junk line; the blank line is not a line.
    assert_eq!(log.unparsed, 2, "{:?}", log.records.len());
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_odin-say"))
        .args([
            "board",
            "events",
            "--board",
            fixtures().join("board.md").to_str().unwrap(),
            "--proof-log",
            fixtures().join("proof.log").to_str().unwrap(),
            "--out",
            &std::env::temp_dir()
                .join("odin-board-events-fixture.jsonl")
                .to_string_lossy(),
        ])
        .output()
        .expect("run");
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stderr).contains("2 unparsed proof lines"));
}

#[test]
fn the_written_file_matches_the_library_output() {
    let dir = std::env::temp_dir().join(format!("odin-board-events-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let out_a = dir.join("a.jsonl");
    let out_b = dir.join("b.jsonl");
    for out in [&out_a, &out_b] {
        let result = std::process::Command::new(env!("CARGO_BIN_EXE_odin-say"))
            .args([
                "board",
                "events",
                "--board",
                fixtures().join("board.md").to_str().unwrap(),
                "--proof-log",
                fixtures().join("proof.log").to_str().unwrap(),
                "--out",
                out.to_str().unwrap(),
            ])
            .output()
            .expect("run");
        assert_eq!(result.status.code(), Some(0));
    }
    let a = std::fs::read(&out_a).expect("a");
    let b = std::fs::read(&out_b).expect("b");
    assert_eq!(a, b);
    assert_eq!(String::from_utf8_lossy(&a), events());
}

#[test]
fn deliveries_from_before_the_first_board_day_are_not_in_the_log() {
    let log_text = format!(
        "2026-11-09T23:59:59Z target_surface_locator=surface:1000000111 submitted=true observed_processing_state=DELIVERED_ACKED\n{}",
        read("proof.log")
    );
    let text = event_log(&read("board.md"), &read_proof_log(&log_text)).expect("events");
    assert!(!text.contains("2026-11-09T23:59:59Z"), "{text}");
}

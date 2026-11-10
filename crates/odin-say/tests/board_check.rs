//! Proof 2 (dispatch-delivered): `board check` passes a board whose DISPATCHED stamps match
//! fixture deliveries, and fails each of: no stamp, a stamp with no record, a stamp matching only
//! a refusal, a stamp matching a delivery to another seat's surface, and a four-field line.

use odin_say::board::{
    build_seat_map, check_board, read_proof_log, read_seat_sources, read_tree_json, seat_map_json,
};

fn fixtures() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/board")
}

fn read(name: &str) -> String {
    std::fs::read_to_string(fixtures().join(name)).expect(name)
}

fn proof() -> odin_say::board::ProofLog {
    read_proof_log(&read("proof.log"))
}

fn seat_map() -> serde_json::Value {
    serde_json::from_str(&read("seat-map.json")).expect("seat map json")
}

#[test]
fn a_board_whose_stamps_are_proved_passes() {
    let board = "\
2026-11-10T13:28:36Z | A | M01 | DISPATCHED DEV1 merge abc1234 | briefs/m01.md delivered=13:28:07Z
2026-11-10T13:28:36Z | A | M02 | DISPATCHED QA2 merge abc1234 | briefs/m02.md delivered=2026-11-10T13:28:13Z
";
    let report = check_board(board, &proof(), None);
    assert!(report.findings.is_empty(), "{:?}", report.findings);
    assert_eq!((report.checked, report.dispatched), (2, 2));
}

#[test]
fn every_failure_reason_is_named_with_its_line() {
    let report = check_board(&read("board.md"), &proof(), Some(&seat_map()));
    let seen: Vec<(usize, &str)> = report
        .findings
        .iter()
        .map(|finding| (finding.line_no, finding.reason))
        .collect();
    assert_eq!(
        seen,
        vec![
            (5, "DISPATCH_NO_DELIVERED"),  // no stamp
            (6, "DELIVERED_NO_PROOF"),     // no record at that second
            (7, "DELIVERED_NO_PROOF"),     // matches only a refusal
            (8, "DELIVERED_WRONG_TARGET"), // proved on another seat's surface
            (9, "MALFORMED_FIELDS"),       // four fields
        ],
        "{:?}",
        report.findings
    );
    assert!(report.findings[0].detail.contains("DISPATCHED DEV3"));
}

#[test]
fn a_board_with_no_failure_exits_clean_through_the_binary() {
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_odin-say"))
        .args([
            "board",
            "check",
            "--board",
            fixtures().join("board_ok.md").to_str().unwrap(),
            "--proof-log",
            fixtures().join("proof.log").to_str().unwrap(),
        ])
        .output()
        .expect("run");
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn the_fixture_board_exits_one_and_prints_line_numbers() {
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_odin-say"))
        .args([
            "board",
            "check",
            "--board",
            fixtures().join("board.md").to_str().unwrap(),
            "--proof-log",
            fixtures().join("proof.log").to_str().unwrap(),
            "--seat-map-json",
            fixtures().join("seat-map.json").to_str().unwrap(),
        ])
        .output()
        .expect("run");
    assert_eq!(out.status.code(), Some(1));
    let stdout = String::from_utf8_lossy(&out.stdout);
    for expected in [
        "line 5: DISPATCH_NO_DELIVERED",
        "line 6: DELIVERED_NO_PROOF",
        "line 7: DELIVERED_NO_PROOF",
        "line 8: DELIVERED_WRONG_TARGET",
        "line 9: MALFORMED_FIELDS",
        "hint: delivery 2026-11-10T13:28:07Z to surface:1000000111",
    ] {
        assert!(
            stdout.contains(expected),
            "{expected} missing from:\n{stdout}"
        );
    }
}

#[test]
fn a_wrong_target_is_reported_only_when_a_seat_map_names_the_seat() {
    let board = "2026-11-10T13:28:36Z | A | M06 | DISPATCHED QA2 wrong seat | briefs/m06.md delivered=13:28:07Z\n";
    // 13:28:07Z is a delivery to DEV1's surface, so a QA2 dispatch is the wrong target.
    let sources = vec![
        ("staffing.md".to_owned(), read("staffing.md")),
        ("custody.md".to_owned(), read("custody.md")),
    ];
    let panes = read_tree_json(&read("tree.json")).expect("tree");
    let map = seat_map_json(&build_seat_map(&read_seat_sources(&sources), &panes));
    let report = check_board(board, &proof(), Some(&map));
    assert_eq!(report.findings.len(), 1, "{:?}", report.findings);
    assert_eq!(report.findings[0].reason, "DELIVERED_WRONG_TARGET");
    // Without the map there is no seat to compare against, so the stamp alone passes.
    assert!(check_board(board, &proof(), None).findings.is_empty());
}

#[test]
fn a_stamp_in_the_state_field_is_accepted_and_still_proved() {
    // The consumer sometimes writes the stamp at the end of the state text instead of the
    // pointer; the stamp must still match a submitted DELIVERED_* record.
    let ok =
        "2026-11-10T13:28:36Z | A | M02 | DISPATCHED DEV1 delivered=13:28:07Z | briefs/m02.md\n";
    assert!(check_board(ok, &proof(), None).findings.is_empty());
    let unproved =
        "2026-11-10T13:28:36Z | A | M02 | DISPATCHED DEV1 delivered=13:29:59Z | briefs/m02.md\n";
    let report = check_board(unproved, &proof(), None);
    assert_eq!(report.findings.len(), 1);
    assert_eq!(report.findings[0].reason, "DELIVERED_NO_PROOF");
}

#[test]
fn a_missing_board_file_exits_two() {
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_odin-say"))
        .args([
            "board",
            "check",
            "--board",
            fixtures().join("no-such-board.md").to_str().unwrap(),
            "--proof-log",
            fixtures().join("proof.log").to_str().unwrap(),
        ])
        .output()
        .expect("run");
    assert_eq!(out.status.code(), Some(2));
}

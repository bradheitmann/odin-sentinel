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

// F1: the previous-day rule for a short stamp, including a month boundary.
#[test]
fn a_short_stamp_later_than_the_line_is_read_on_the_previous_day() {
    let log = read_proof_log(
        "2026-11-09T23:58:00Z target_surface_locator=surface:1000000111 submitted=true observed_processing_state=DELIVERED_ACKED\n",
    );
    let board = "2026-11-10T00:05:00Z | A | M01 | DISPATCHED DEV1 midnight dispatch | briefs/m01.md delivered=23:58:00Z\n";
    assert!(check_board(board, &log, None).findings.is_empty());
}

#[test]
fn the_previous_day_rule_does_not_invent_a_delivery() {
    let log = read_proof_log(
        "2026-11-10T00:04:00Z target_surface_locator=surface:1000000111 submitted=true observed_processing_state=DELIVERED_ACKED\n",
    );
    let board = "2026-11-10T00:05:00Z | A | M01 | DISPATCHED DEV1 midnight dispatch | briefs/m01.md delivered=23:58:00Z\n";
    let report = check_board(board, &log, None);
    assert_eq!(report.findings.len(), 1, "{:?}", report.findings);
    assert_eq!(report.findings[0].reason, "DELIVERED_NO_PROOF");
}

#[test]
fn the_previous_day_rule_crosses_a_month_boundary() {
    let log = read_proof_log(
        "2026-10-31T23:59:00Z target_surface_locator=surface:1000000111 submitted=true observed_processing_state=DELIVERED_NO_ACK\n",
    );
    let board = "2026-11-01T00:01:00Z | A | M01 | DISPATCHED DEV1 month boundary | briefs/m01.md delivered=23:59:00Z\n";
    assert!(check_board(board, &log, None).findings.is_empty());
}

#[test]
fn a_full_utc_stamp_is_used_as_written_even_when_it_is_the_previous_day() {
    let log = read_proof_log(
        "2026-11-09T23:58:00Z target_surface_locator=surface:1000000111 submitted=true observed_processing_state=DELIVERED_ACKED\n",
    );
    let board = "2026-11-10T00:05:00Z | A | M01 | DISPATCHED DEV1 explicit stamp | briefs/m01.md delivered=2026-11-09T23:58:00Z\n";
    assert!(check_board(board, &log, None).findings.is_empty());
}

// F2: the stamp counts in the pointer field and at the end of the state field, and nowhere else.
#[test]
fn a_stamp_in_the_seat_or_lane_field_does_not_count() {
    let reporter = "2026-11-10T13:28:36Z | A delivered=13:28:07Z | M01 | DISPATCHED DEV1 seen in the lane field | briefs/m01.md\n";
    let report = check_board(reporter, &proof(), None);
    assert_eq!(report.findings.len(), 1, "{:?}", report.findings);
    assert_eq!(report.findings[0].reason, "DISPATCH_NO_DELIVERED");
    let in_seat = "2026-11-10T13:28:36Z | A | M01 delivered=13:28:07Z | DISPATCHED DEV1 seen in the lane field | briefs/m01.md\n";
    let report = check_board(in_seat, &proof(), None);
    assert_eq!(report.findings.len(), 1, "{:?}", report.findings);
    assert_eq!(report.findings[0].reason, "DISPATCH_NO_DELIVERED");
}

// ---- board-check-rules proofs 1-3 ------------------------------------------------

fn rules_seat_map() -> serde_json::Value {
    serde_json::json!({
        "rows": [
            { "seat": "DEV1", "surface": "1000000111" },
            { "seat": "QA2", "surface": "1000000112" },
            { "seat": "DEV3", "surface": "1000000113" }
        ]
    })
}

fn log_of(rows: &[(&str, &str, bool)]) -> odin_say::board::ProofLog {
    let text: String = rows
        .iter()
        .map(|(ts, surface, submitted)| {
            format!(
                "{ts} target_surface_locator=surface:{surface} submitted={submitted} observed_processing_state={}\n",
                if *submitted { "DELIVERED_ACKED" } else { "PANE_STILL_THINKING" }
            )
        })
        .collect();
    read_proof_log(&text)
}

// Proof 1: a short stamp is looked up on the line's day first (the "(late)" idiom).
#[test]
fn rules1_a_late_same_day_stamp_passes() {
    let log = log_of(&[("2026-11-10T13:58:11Z", "1000000111", true)]);
    let board = "2026-11-10T13:47:40Z | A | M01 | DISPATCHED DEV1 merge (late) | briefs/m01.md delivered=13:58:11Z\n";
    let report = check_board(board, &log, Some(&rules_seat_map()));
    assert!(report.findings.is_empty(), "{:?}", report.findings);
}

#[test]
fn rules1_the_midnight_and_month_cases_still_hold() {
    // previous day, because the stamp is later than the line and no same-day delivery exists
    let log = log_of(&[("2026-11-09T23:58:00Z", "1000000111", true)]);
    let board = "2026-11-10T00:05:00Z | A | M01 | DISPATCHED DEV1 midnight | briefs/m01.md delivered=23:58:00Z\n";
    assert!(check_board(board, &log, Some(&rules_seat_map()))
        .findings
        .is_empty());
    // ... and with no delivery on either day it fails
    assert_eq!(
        check_board(
            board,
            &log_of(&[("2026-11-10T00:04:00Z", "1000000111", true)]),
            Some(&rules_seat_map())
        )
        .findings[0]
            .reason,
        "DELIVERED_NO_PROOF"
    );
    // month boundary
    let month = log_of(&[("2026-10-31T23:59:00Z", "1000000111", true)]);
    let line = "2026-11-01T00:01:00Z | A | M01 | DISPATCHED DEV1 month | briefs/m01.md delivered=23:59:00Z\n";
    assert!(check_board(line, &month, Some(&rules_seat_map()))
        .findings
        .is_empty());
}

// Proof 2: any named seat may be the target, in any order.
#[test]
fn rules2_a_delivery_to_any_named_seat_satisfies_the_line() {
    let log = log_of(&[
        ("2026-11-10T13:58:01Z", "1000000112", true),
        ("2026-11-10T13:58:02Z", "1000000111", true),
        ("2026-11-10T13:58:03Z", "1000000113", true),
    ]);
    let board = "2026-11-10T13:47:40Z | A | M09 | DISPATCHED DEV1 QA2 DEV3 three seats | briefs/m09.md delivered=13:58:01Z delivered=13:58:02Z delivered=13:58:03Z\n";
    let report = check_board(board, &log, Some(&rules_seat_map()));
    assert!(report.findings.is_empty(), "{:?}", report.findings);
    assert!(report.notes.is_empty(), "{:?}", report.notes);
}

#[test]
fn rules2_an_unnamed_target_still_fails() {
    let log = log_of(&[("2026-11-10T13:58:01Z", "1000000999", true)]);
    let board = "2026-11-10T13:47:40Z | A | M09 | DISPATCHED DEV1 QA2 three seats | briefs/m09.md delivered=13:58:01Z\n";
    let report = check_board(board, &log, Some(&rules_seat_map()));
    assert_eq!(report.findings.len(), 1, "{:?}", report.findings);
    assert_eq!(report.findings[0].reason, "DELIVERED_WRONG_TARGET");
}

#[test]
fn rules2_no_mapped_seat_accepts_any_delivery_and_punctuation_still_counts() {
    let log = log_of(&[("2026-11-10T13:58:01Z", "1000000999", true)]);
    let any = "2026-11-10T13:47:40Z | A | M09 | DISPATCHED somebody else | briefs/m09.md delivered=13:58:01Z\n";
    assert!(check_board(any, &log, Some(&rules_seat_map()))
        .findings
        .is_empty());
    // A name followed by a comma or a closing parenthesis is still recognised: the delivery to an
    // unnamed surface must now fail.
    for state in ["DISPATCHED DEV1, QA2", "DISPATCHED (DEV1) QA2"] {
        let board = format!(
            "2026-11-10T13:47:40Z | A | M09 | {state} | briefs/m09.md delivered=13:58:01Z\n"
        );
        let report = check_board(&board, &log, Some(&rules_seat_map()));
        assert_eq!(report.findings.len(), 1, "{state}: {:?}", report.findings);
        assert_eq!(
            report.findings[0].reason, "DELIVERED_WRONG_TARGET",
            "{state}"
        );
    }
}

// Proof 3: an uncovered named seat is a note, never a finding.
#[test]
fn rules3_an_uncovered_named_seat_is_a_note_and_the_line_still_passes() {
    let log = log_of(&[("2026-11-10T13:58:01Z", "1000000111", true)]);
    let board = "2026-11-10T13:47:40Z | A | M09 | DISPATCHED DEV1 QA2 partial | briefs/m09.md delivered=13:58:01Z\n";
    let report = check_board(board, &log, Some(&rules_seat_map()));
    assert!(report.findings.is_empty(), "{:?}", report.findings);
    assert_eq!(report.notes.len(), 1);
    assert_eq!(report.notes[0].reason, "SEAT_NOT_COVERED");
    assert_eq!(report.notes[0].seat, "QA2");
    // A fully covered line has no note.
    let covered = log_of(&[
        ("2026-11-10T13:58:01Z", "1000000111", true),
        ("2026-11-10T13:58:02Z", "1000000112", true),
    ]);
    let board = "2026-11-10T13:47:40Z | A | M09 | DISPATCHED DEV1 QA2 full | briefs/m09.md delivered=13:58:01Z delivered=13:58:02Z\n";
    assert!(check_board(board, &covered, Some(&rules_seat_map()))
        .notes
        .is_empty());
}

#[test]
fn rules3_the_binary_prints_the_note_and_exits_zero() {
    let dir = std::env::temp_dir().join(format!("odin-board-rules3-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let board = dir.join("board.md");
    let log = dir.join("proof.log");
    let map = dir.join("seat-map.json");
    std::fs::write(&board, "2026-11-10T13:47:40Z | A | M09 | DISPATCHED DEV1 QA2 partial | briefs/m09.md delivered=13:58:01Z\n").expect("board");
    std::fs::write(&log, "2026-11-10T13:58:01Z target_surface_locator=surface:1000000111 submitted=true observed_processing_state=DELIVERED_ACKED\n").expect("log");
    std::fs::write(&map, rules_seat_map().to_string()).expect("map");
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_odin-say"))
        .args([
            "board",
            "check",
            "--board",
            board.to_str().unwrap(),
            "--proof-log",
            log.to_str().unwrap(),
            "--seat-map-json",
            map.to_str().unwrap(),
        ])
        .output()
        .expect("run");
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("note: line 1: SEAT_NOT_COVERED QA2"),
        "{stdout}"
    );
    assert!(stdout.contains("0 findings, 1 notes"), "{stdout}");
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

//! Proof 4 (post-proved): a DISPATCHED post carries the delivery that proves it and passes
//! `board check`; without one in the window it exits 3 and writes nothing; a pipe in a field is
//! refused; existing lines stay byte-identical.

use odin_say::board::{
    append_line, build_post_line, check_board, read_proof_log, PostRefusal, PostRequest,
};

fn fixtures() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/board")
}

fn read(name: &str) -> String {
    std::fs::read_to_string(fixtures().join(name)).expect(name)
}

/// 2026-11-10T13:29:00Z
const NOW: u64 = 1_794_317_340;

fn request(state: &str, text: &str, pointer: &str) -> PostRequest {
    PostRequest {
        seat: "A".to_owned(),
        lane: "M09".to_owned(),
        state: state.to_owned(),
        text: text.to_owned(),
        pointer: pointer.to_owned(),
        surface: Some("surface:1000000111".to_owned()),
    }
}

#[test]
fn a_dispatched_post_carries_the_delivery_and_passes_check() {
    let log = read_proof_log(&read("proof.log"));
    let request = request("DISPATCHED", "DEV1 merge abc1234", "briefs/m09.md");
    let line = build_post_line(&request, NOW, Some(&log), 600).expect("post");
    assert!(line.contains("delivered=13:28:07Z"), "{line}");
    assert!(
        line.starts_with("2026-11-10T13:29:00Z | A | M09 | DISPATCHED DEV1 merge abc1234 | "),
        "{line}"
    );
    let report = check_board(&format!("{line}\n"), &log, None);
    assert!(report.findings.is_empty(), "{:?}", report.findings);
}

#[test]
fn without_a_delivery_in_the_window_the_post_is_refused_and_nothing_is_written() {
    let dir = std::env::temp_dir().join(format!("odin-board-post-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let board = dir.join("board.md");
    std::fs::write(&board, read("board_ok.md")).expect("board");
    let before = std::fs::read(&board).expect("before");

    let log = read_proof_log(&read("proof.log"));
    let request = request("DISPATCHED", "DEV1 late retry", "briefs/m09.md");
    // One hour after the only delivery: outside a ten-minute window.
    let refusal = build_post_line(&request, NOW + 3600, Some(&log), 600).expect_err("refused");
    assert!(matches!(refusal, PostRefusal::NoDelivery(_)), "{refusal:?}");
    assert_eq!(refusal.exit_code(), 3);
    assert_eq!(
        std::fs::read(&board).expect("after"),
        before,
        "the board must not change"
    );
}

#[test]
fn a_field_with_a_pipe_is_refused() {
    let request = request("STARTED", "a | b", "pane report");
    let refusal = build_post_line(&request, NOW, None, 600).expect_err("refused");
    assert_eq!(refusal, PostRefusal::Field("text".to_owned()));
    assert_eq!(refusal.exit_code(), 2);
}

#[test]
fn existing_lines_are_byte_identical_after_a_post() {
    let dir = std::env::temp_dir().join(format!("odin-board-post-append-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let board = dir.join("board.md");
    std::fs::write(&board, read("board_ok.md")).expect("board");
    let before = std::fs::read(&board).expect("before");

    let line =
        build_post_line(&request("STARTED", "pane report", "pane"), NOW, None, 600).expect("post");
    let written = append_line(&board, &line).expect("append");
    let after = std::fs::read(&board).expect("after");
    assert_eq!(written, line.len() + 1);
    assert_eq!(
        &after[..before.len()],
        &before[..],
        "earlier lines stay byte-identical"
    );
    assert_eq!(
        String::from_utf8_lossy(&after[before.len()..]),
        format!("{line}\n")
    );
}

#[test]
fn the_binary_exits_three_and_writes_nothing_without_a_proof() {
    let dir = std::env::temp_dir().join(format!("odin-board-post-cli-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let board = dir.join("board.md");
    std::fs::write(&board, read("board_ok.md")).expect("board");
    let before = std::fs::read(&board).expect("before");

    let out = std::process::Command::new(env!("CARGO_BIN_EXE_odin-say"))
        .args([
            "board",
            "post",
            "--board",
            board.to_str().unwrap(),
            "--seat",
            "A",
            "--lane",
            "M09",
            "--state",
            "DISPATCHED",
            "--text",
            "DEV1 with no proving delivery",
            "--pointer",
            "briefs/m09.md",
            "--surface",
            "surface:1000000111",
            "--proof-log",
            fixtures().join("proof.log").to_str().unwrap(),
            "--window-secs",
            "1",
        ])
        .output()
        .expect("run");
    assert_eq!(
        out.status.code(),
        Some(3),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stderr).contains("refused"));
    assert_eq!(std::fs::read(&board).expect("after"), before);
}

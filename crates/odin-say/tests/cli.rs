//! The real `odin-say` binary against a fake pane-multiplexer executable
//! (`examples/fake_cmux.rs`): argument shapes, exit codes, and the proof record.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const BIN: &str = env!("CARGO_BIN_EXE_odin-say");
const SEP: char = '\u{1f}';

fn fake_cmux() -> PathBuf {
    let exe = std::env::current_exe().expect("current_exe");
    let debug_dir = exe.parent().and_then(Path::parent).expect("target dir");
    let fake = debug_dir.join("examples/fake_cmux");
    assert!(
        fake.exists(),
        "{} is missing: run the whole suite with `cargo test` so examples are built",
        fake.display()
    );
    fake
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

struct Rig {
    dir: tempfile::TempDir,
}

impl Rig {
    fn new(screens: &[&str]) -> Self {
        let dir = tempfile::tempdir().expect("tmp");
        for (n, name) in screens.iter().enumerate() {
            let text =
                std::fs::read_to_string(fixtures().join("screens").join(format!("{name}.txt")))
                    .expect("screen fixture");
            std::fs::write(dir.path().join(format!("screen.{}", n + 1)), text).expect("screen");
        }
        Self { dir }
    }

    fn proof(&self) -> PathBuf {
        self.dir.path().join("proof.log")
    }

    fn command(&self) -> Command {
        let mut c = Command::new(BIN);
        c.env("ODIN_SAY_CMUX", fake_cmux())
            .env("ODIN_SAY_TIME_SCALE", "0")
            .env("ODIN_SAY_PROOF", self.proof())
            .env("FAKE_CMUX_DIR", self.dir.path());
        c
    }

    fn calls(&self) -> Vec<Vec<String>> {
        std::fs::read_to_string(self.dir.path().join("log"))
            .unwrap_or_default()
            .lines()
            .map(|l| l.split(SEP).map(str::to_string).collect())
            .collect()
    }
}

fn text(out: &Output) -> (String, String) {
    (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn proof_lines(path: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).expect("proof line is JSON"))
        .collect()
}

#[test]
fn say_delivers_through_the_pane_binary_and_writes_a_proof_record() {
    let rig = Rig::new(&["codex_idle", "codex_acked_after_send"]);
    let out = rig
        .command()
        .args(["say", "7", "run the gate on branch feat-x", "please"])
        .output()
        .expect("run");
    let (stdout, stderr) = text(&out);
    assert_eq!(out.status.code(), Some(0), "{stderr}");
    assert_eq!(stdout.trim(), "say: 7 DELIVERED_ACKED (echoed)");

    let calls = rig.calls();
    assert_eq!(calls[0], ["read-screen", "--surface", "surface:7"]);
    assert_eq!(
        calls[1],
        [
            "send",
            "--surface",
            "surface:7",
            "run the gate on branch feat-x please"
        ]
    );
    assert_eq!(calls[2], ["send-key", "--surface", "surface:7", "Enter"]);
    assert_eq!(calls.iter().filter(|c| c[0] == "send-key").count(), 1);

    let proof = proof_lines(&rig.proof());
    assert_eq!(proof.len(), 1);
    assert_eq!(proof[0]["record_kind"], "delivery");
    assert_eq!(proof[0]["target_surface_locator"], "surface:7");
    assert_eq!(proof[0]["observed_processing_state"], "DELIVERED_ACKED");
    assert_eq!(proof[0]["submitted"], true);
    assert_eq!(proof[0]["verification_method"], "read_screen");
    assert_eq!(proof[0]["sender_role"], "EXEC PM");
    assert!(proof[0]["timestamp"]
        .as_str()
        .is_some_and(|t| t.ends_with('Z')));
}

#[test]
fn say_refuses_a_blocked_pane_with_a_non_zero_exit_and_sends_nothing() {
    let rig = Rig::new(&["permission_prompt"]);
    let out = rig
        .command()
        .args(["say", "surface:7", "hello"])
        .output()
        .expect("run");
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(
        text(&out).0.trim(),
        "say: surface:7 PANE_BLOCKED_ON_PERMISSION (pre-send)"
    );
    assert!(rig.calls().iter().all(|c| c[0] == "read-screen"));
    let proof = proof_lines(&rig.proof());
    assert_eq!(proof.len(), 1);
    assert_eq!(proof[0]["record_kind"], "send_refusal");
    assert_eq!(proof[0]["submitted"], false);
    assert_eq!(
        proof[0]["observed_processing_state"],
        "PANE_BLOCKED_ON_PERMISSION"
    );
}

#[test]
fn the_default_proof_path_is_under_the_xdg_state_home() {
    let rig = Rig::new(&["codex_idle", "codex_acked_after_send"]);
    let state = rig.dir.path().join("state");
    let out = rig
        .command()
        .env_remove("ODIN_SAY_PROOF")
        .env("XDG_STATE_HOME", &state)
        .args(["say", "7", "run the gate"])
        .output()
        .expect("run");
    assert_eq!(out.status.code(), Some(0), "{}", text(&out).1);
    let path = state.join("odin").join("delivery-proof.jsonl");
    let proof = proof_lines(&path);
    assert_eq!(proof.len(), 1);
    assert_eq!(proof[0]["record_kind"], "delivery");
}

#[test]
fn the_sender_role_flag_reaches_the_proof_record() {
    let rig = Rig::new(&["codex_idle", "codex_acked_after_send"]);
    let out = rig
        .command()
        .args(["say", "7", "--sender-role", "QA", "--proof"])
        .arg(rig.proof())
        .arg("run the gate")
        .output()
        .expect("run");
    assert_eq!(out.status.code(), Some(0), "{}", text(&out).1);
    let proof = proof_lines(&rig.proof());
    assert_eq!(proof[0]["sender_role"], "QA");
}

#[test]
fn status_prints_the_typed_pane_state_and_sends_nothing() {
    let rig = Rig::new(&["opencode_overlay"]);
    let out = rig.command().args(["status", "7"]).output().expect("run");
    assert_eq!(text(&out).0.trim(), "status: 7 blocked");
    assert!(rig.calls().iter().all(|c| c[0] == "read-screen"));
}

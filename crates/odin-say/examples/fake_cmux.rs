//! Test double for the pane multiplexer binary, driven by environment variables:
//! `FAKE_CMUX_DIR` holds `screen.1`, `screen.2`, ... (the Nth read-screen prints screen.N,
//! the last one repeats) and receives `log` (one line of arguments per call).
//! `FAKE_CMUX_FAIL_SEND=1` makes `send` and `send-key` exit 1.

use std::io::Write;

fn main() {
    let dir =
        std::path::PathBuf::from(std::env::var("FAKE_CMUX_DIR").unwrap_or_else(|_| ".".into()));
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("log"))
        .expect("open log");
    writeln!(log, "{}", args.join("\u{1f}")).expect("write log");
    match args.first().map(String::as_str) {
        Some("read-screen") => {
            let counter = dir.join("reads");
            let n: usize = std::fs::read_to_string(&counter)
                .ok()
                .and_then(|t| t.trim().parse().ok())
                .unwrap_or(0)
                + 1;
            std::fs::write(&counter, n.to_string()).expect("write counter");
            let mut pick = n;
            while pick > 1 && !dir.join(format!("screen.{pick}")).exists() {
                pick -= 1;
            }
            let text =
                std::fs::read_to_string(dir.join(format!("screen.{pick}"))).unwrap_or_default();
            print!("{text}");
        }
        Some("send") | Some("send-key") => {
            if std::env::var("FAKE_CMUX_FAIL_SEND").is_ok_and(|v| v == "1") {
                std::process::exit(1);
            }
        }
        _ => std::process::exit(2),
    }
}

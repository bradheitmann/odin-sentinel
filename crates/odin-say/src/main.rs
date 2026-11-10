#![forbid(unsafe_code)]
//! `odin-say` CLI: deliver one line to a pane with a proof record, or classify a pane.

use anyhow::Result;
use clap::{Parser, Subcommand};
use odin_say::board;
use odin_say::clock::RealClock;
use odin_say::cmux::{Cmux, RealCmux};
use odin_say::config::{Config, ConfigFlags};
use odin_say::proof::{self, ProofEntry};
use odin_say::rules::PaneRules;
use odin_say::say::{self, DeliveryOptions, Outcome};
use odin_say::timeutil;
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "odin-say",
    version,
    about = "Deliver one line to a pane with a read-screen proof record"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Deliver text to a pane (exit 0 only on DELIVERED_*).
    Say {
        surface: String,
        #[arg(required = true, trailing_var_arg = true, allow_hyphen_values = true)]
        text: Vec<String>,
        /// Seconds between pane reads while waiting for a busy pane.
        #[arg(long)]
        poll_secs: Option<u64>,
        /// Seconds to wait for a busy pane before refusing.
        #[arg(long)]
        wait_secs: Option<u64>,
        /// Proof log path (default: $XDG_STATE_HOME/odin/delivery-proof.jsonl).
        #[arg(long)]
        proof: Option<PathBuf>,
        /// Sender role recorded in the proof.
        #[arg(long)]
        sender_role: Option<String>,
        /// Pane-rules JSON file (default: the embedded rules).
        #[arg(long)]
        pane_rules: Option<PathBuf>,
        /// Harness name for the mid-turn policy (default: ODIN_SAY_HARNESS, then detection).
        #[arg(long)]
        harness: Option<String>,
    },
    /// Classify a pane (blocked, busy, capped, stale_input, idle) without sending anything.
    Status {
        surface: String,
        /// Pane-rules JSON file (default: the embedded rules).
        #[arg(long)]
        pane_rules: Option<PathBuf>,
    },
    /// Board: seat map, dispatch check, ordered event log, or one posted line.
    Board {
        #[command(subcommand)]
        command: BoardCommand,
    },
}

#[derive(Subcommand)]
enum BoardCommand {
    /// Join the hand-written seat pages with the live pane tree.
    SeatMap {
        /// A seat page (`-` reads stdin). Repeat for every page.
        #[arg(long = "source", required = true)]
        sources: Vec<String>,
        /// The multiplexer's JSON tree listing (`-` reads stdin).
        #[arg(long)]
        tree_json: String,
        /// Where to write the markdown page.
        #[arg(long)]
        out_md: PathBuf,
        /// Where to write the JSON rows.
        #[arg(long)]
        out_json: PathBuf,
    },
    /// Type every board line and verify each DISPATCHED line against the proof log.
    Check {
        /// The board file.
        #[arg(long)]
        board: PathBuf,
        /// The shell sender's delivery-proof log.
        #[arg(long)]
        proof_log: PathBuf,
        /// The JSON rows `board seat-map --out-json` wrote.
        #[arg(long)]
        seat_map_json: Option<PathBuf>,
    },
    /// One JSON-lines event log, ordered by time then input order.
    Events {
        /// The board file.
        #[arg(long)]
        board: PathBuf,
        /// The shell sender's delivery-proof log.
        #[arg(long)]
        proof_log: PathBuf,
        /// Where to write the event log.
        #[arg(long)]
        out: PathBuf,
    },
    /// Append one typed board line.
    Post {
        /// The board file to append to.
        #[arg(long)]
        board: PathBuf,
        /// Seat column.
        #[arg(long)]
        seat: String,
        /// Lane column.
        #[arg(long)]
        lane: String,
        /// State column: a state word, then the text.
        #[arg(long)]
        state: String,
        /// Text that follows the state word.
        #[arg(long)]
        text: String,
        /// Pointer column.
        #[arg(long)]
        pointer: String,
        /// Surface the dispatch went to (required for DISPATCHED).
        #[arg(long)]
        surface: Option<String>,
        /// Proof log searched for the delivery that proves this post.
        #[arg(long)]
        proof_log: Option<PathBuf>,
        /// How far back a proving delivery may be, in seconds.
        #[arg(long, default_value_t = 600)]
        window_secs: u64,
    },
}

fn main() {
    match run() {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("odin-say: {e:#}");
            std::process::exit(1);
        }
    }
}

fn rules_for(path: &Option<PathBuf>) -> Result<PaneRules> {
    match path {
        Some(path) => PaneRules::from_path(path),
        None => Ok(PaneRules::embedded().clone()),
    }
}

/// Write the record for one outcome. A failed write is loud and non-zero: the send already
/// happened, so the record JSON is printed on stderr and the process exits with
/// PROOF_RECORD_LOST rather than reporting a delivery nobody recorded.
fn record_outcome(
    subcommand: &str,
    surface: &str,
    outcome: &Outcome,
    config: &Config,
) -> Result<()> {
    let entry = ProofEntry::for_outcome(
        subcommand,
        surface,
        outcome,
        &config.sender_role,
        timeutil::now_utc(),
    );
    if let Err(e) = proof::append(&config.proof_path, &entry) {
        eprintln!(
            "odin-say: {}: {}: {e}",
            proof::PROOF_RECORD_LOST,
            config.proof_path.display()
        );
        eprintln!("{}", serde_json::to_string(&entry).unwrap_or_default());
        anyhow::bail!("{e}");
    }
    Ok(())
}

fn run() -> Result<i32> {
    let cli = Cli::parse();
    match cli.command {
        Command::Say {
            surface,
            text,
            poll_secs,
            wait_secs,
            proof,
            sender_role,
            pane_rules,
            harness,
        } => {
            let flags = ConfigFlags {
                proof,
                sender_role,
                pane_rules: pane_rules.clone(),
                poll_secs,
                wait_secs,
                harness,
            };
            let config = Config::resolve(&flags, &|key| std::env::var(key).ok());
            let rules = rules_for(&config.pane_rules_path)?;
            let cmux = RealCmux::new(&config.cmux_binary);
            let options = DeliveryOptions {
                poll: config.poll,
                wait: config.wait,
            };
            let selector = odin_say::identity::HarnessSelector {
                flag: config.harness_flag.clone(),
                env: config.harness_env.clone(),
            };
            // No record, no send: prove the proof log writable before the pane is touched.
            if let Err(e) = proof::preflight(&config.proof_path) {
                eprintln!(
                    "odin-say: {}: {}: {e}",
                    proof::PROOF_LOG_UNWRITABLE,
                    config.proof_path.display()
                );
                return Ok(proof::EXIT_PROOF_LOG_UNWRITABLE);
            }
            let outcome = say::deliver(
                &cmux,
                &RealClock::from_env(),
                &rules,
                &selector,
                &say::surface_locator(&surface),
                &text.join(" "),
                &options,
            );
            println!(
                "say: {surface} {} ({})",
                outcome.state.as_str(),
                outcome.note
            );
            // A record that cannot be written after the send is never exit 0.
            if record_outcome("say", &surface, &outcome, &config).is_err() {
                return Ok(proof::EXIT_PROOF_RECORD_LOST);
            }
            Ok(outcome.exit)
        }
        Command::Status {
            surface,
            pane_rules,
        } => {
            let config = Config::resolve(
                &ConfigFlags {
                    pane_rules,
                    ..Default::default()
                },
                &|key| std::env::var(key).ok(),
            );
            let rules = rules_for(&config.pane_rules_path)?;
            let cmux = RealCmux::new(&config.cmux_binary);
            let locator = say::surface_locator(&surface);
            let screen = match cmux.read_screen(&locator) {
                Ok(raw) => say::tail14(&raw),
                Err(failure) => {
                    // A failed read is not an idle pane: report it and exit non-zero.
                    eprintln!("status: {failure}");
                    return Ok(say::EXIT_READ_FAILED);
                }
            };
            let state = say::classify(&screen, &rules);
            let mut line = format!("status: {surface} {}", state.as_str());
            if state == say::PaneState::Capped {
                if let Some(hit) = say::capped(&screen, &rules) {
                    line.push_str(&format!(" marker={}", hit.marker));
                    if let Some(reset_at) = hit.reset_at {
                        line.push_str(&format!(" reset_at={reset_at}"));
                    }
                }
            }
            println!("{line}");
            Ok(0)
        }
        Command::Board { command } => run_board(command),
    }
}

fn run_board(command: BoardCommand) -> Result<i32> {
    match command {
        BoardCommand::SeatMap {
            sources,
            tree_json,
            out_md,
            out_json,
        } => {
            let mut texts = Vec::new();
            for path in &sources {
                match board::read_source(path) {
                    Ok(text) => texts.push((path.clone(), text)),
                    Err(e) => {
                        eprintln!("board seat-map: {e}");
                        return Ok(board::EXIT_USAGE);
                    }
                }
            }
            let tree_text = match board::read_source(&tree_json) {
                Ok(text) => text,
                Err(e) => {
                    eprintln!("board seat-map: {e}");
                    return Ok(board::EXIT_USAGE);
                }
            };
            let panes = match board::read_tree_json(&tree_text) {
                Ok(panes) => panes,
                Err(e) => {
                    eprintln!("board seat-map: {e}");
                    return Ok(board::EXIT_USAGE);
                }
            };
            let sources = board::read_seat_sources(&texts);
            let map = board::build_seat_map(&sources, &panes);
            if let Err(e) = std::fs::write(&out_md, board::seat_map_markdown(&map)) {
                eprintln!("board seat-map: {}: {e}", out_md.display());
                return Ok(board::EXIT_USAGE);
            }
            let json = board::seat_map_json(&map);
            if let Err(e) = std::fs::write(
                &out_json,
                format!("{}\n", serde_json::to_string_pretty(&json)?),
            ) {
                eprintln!("board seat-map: {}: {e}", out_json.display());
                return Ok(board::EXIT_USAGE);
            }
            let live = map
                .rows
                .iter()
                .filter(|row| row.status == board::SeatStatus::Live)
                .count();
            println!(
                "board seat-map: {} seats, {live} live, {} unparsed, {} live but unlisted",
                map.rows.len(),
                map.unparsed.len(),
                map.unlisted.len()
            );
            Ok(board::EXIT_OK)
        }
        BoardCommand::Check {
            board: board_path,
            proof_log,
            seat_map_json,
        } => {
            let board_text = match board::read_source(&board_path.to_string_lossy()) {
                Ok(text) => text,
                Err(e) => {
                    eprintln!("board check: {e}");
                    return Ok(board::EXIT_USAGE);
                }
            };
            let log_text = match board::read_source(&proof_log.to_string_lossy()) {
                Ok(text) => text,
                Err(e) => {
                    eprintln!("board check: {e}");
                    return Ok(board::EXIT_USAGE);
                }
            };
            let seat_map_value = match seat_map_json {
                None => None,
                Some(path) => match board::read_source(&path.to_string_lossy()).and_then(|text| {
                    serde_json::from_str::<serde_json::Value>(&text)
                        .map_err(|e| format!("{}: {e}", path.display()))
                }) {
                    Ok(value) => Some(value),
                    Err(e) => {
                        eprintln!("board check: {e}");
                        return Ok(board::EXIT_USAGE);
                    }
                },
            };
            let log = board::read_proof_log(&log_text);
            let report = board::check_board(&board_text, &log, seat_map_value.as_ref());
            for finding in &report.findings {
                println!(
                    "line {}: {} — {}",
                    finding.line_no, finding.reason, finding.detail
                );
                for hint in &finding.hints {
                    println!("  hint: {hint}");
                }
            }
            println!(
                "board check: {} lines, {} dispatched, {} findings, {} unparsed proof lines",
                report.checked,
                report.dispatched,
                report.findings.len(),
                log.unparsed
            );
            if report.findings.is_empty() {
                Ok(board::EXIT_OK)
            } else {
                Ok(board::EXIT_CHECK_FAILED)
            }
        }
        BoardCommand::Events {
            board: board_path,
            proof_log,
            out,
        } => {
            let board_text = match board::read_source(&board_path.to_string_lossy()) {
                Ok(text) => text,
                Err(e) => {
                    eprintln!("board events: {e}");
                    return Ok(board::EXIT_USAGE);
                }
            };
            let log_text = match board::read_source(&proof_log.to_string_lossy()) {
                Ok(text) => text,
                Err(e) => {
                    eprintln!("board events: {e}");
                    return Ok(board::EXIT_USAGE);
                }
            };
            let log = board::read_proof_log(&log_text);
            let events = match board::event_log(&board_text, &log) {
                Ok(events) => events,
                Err(e) => {
                    eprintln!("board events: {e}");
                    return Ok(board::EXIT_USAGE);
                }
            };
            let lines = events.lines().count();
            if let Err(e) = board::write_renamed(&out, &events) {
                eprintln!("board events: {}: {e}", out.display());
                return Ok(board::EXIT_USAGE);
            }
            eprintln!(
                "board events: {lines} events, {} unparsed proof lines",
                log.unparsed
            );
            Ok(board::EXIT_OK)
        }
        BoardCommand::Post {
            board: board_path,
            seat,
            lane,
            state,
            text,
            pointer,
            surface,
            proof_log,
            window_secs,
        } => {
            let log = match proof_log {
                None => None,
                Some(path) => match board::read_source(&path.to_string_lossy()) {
                    Ok(text) => Some(board::read_proof_log(&text)),
                    Err(e) => {
                        eprintln!("board post: {e}");
                        return Ok(board::EXIT_USAGE);
                    }
                },
            };
            let request = board::PostRequest {
                seat,
                lane,
                state,
                text,
                pointer,
                surface,
            };
            match board::build_post_line(&request, timeutil::now_unix(), log.as_ref(), window_secs)
            {
                Ok(line) => match board::append_line(&board_path, &line) {
                    Ok(_) => {
                        println!("{line}");
                        Ok(board::EXIT_OK)
                    }
                    Err(e) => {
                        eprintln!("board post: {}: {e}", board_path.display());
                        Ok(board::EXIT_USAGE)
                    }
                },
                Err(refusal) => {
                    eprintln!("board post: refused — {}", refusal.message());
                    Ok(refusal.exit_code())
                }
            }
        }
    }
}

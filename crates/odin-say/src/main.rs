#![forbid(unsafe_code)]
//! `odin-say` CLI: deliver one line to a pane with a proof record, or classify a pane.

use anyhow::Result;
use clap::{Parser, Subcommand};
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
    },
    /// Classify a pane (blocked, busy, stale_input, idle) without sending anything.
    Status {
        surface: String,
        /// Pane-rules JSON file (default: the embedded rules).
        #[arg(long)]
        pane_rules: Option<PathBuf>,
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

fn log_proof(subcommand: &str, surface: &str, outcome: &Outcome, config: &Config) {
    let entry = ProofEntry::for_outcome(
        subcommand,
        surface,
        outcome,
        &config.sender_role,
        timeutil::now_utc(),
    );
    if let Err(e) = proof::append(&config.proof_path, &entry) {
        eprintln!(
            "odin-say: proof log not written ({}): {e}",
            config.proof_path.display()
        );
    }
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
        } => {
            let flags = ConfigFlags {
                proof,
                sender_role,
                pane_rules: pane_rules.clone(),
                poll_secs,
                wait_secs,
            };
            let config = Config::resolve(&flags, &|key| std::env::var(key).ok());
            let rules = rules_for(&config.pane_rules_path)?;
            let cmux = RealCmux::new(&config.cmux_binary);
            let options = DeliveryOptions {
                poll: config.poll,
                wait: config.wait,
            };
            let outcome = say::deliver(
                &cmux,
                &RealClock::from_env(),
                &rules,
                &say::surface_locator(&surface),
                &text.join(" "),
                &options,
            );
            log_proof("say", &surface, &outcome, &config);
            println!(
                "say: {surface} {} ({})",
                outcome.state.as_str(),
                outcome.note
            );
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
            let screen = say::tail14(&cmux.read_screen(&say::surface_locator(&surface)));
            println!(
                "status: {surface} {}",
                say::classify(&screen, &rules).as_str()
            );
            Ok(0)
        }
    }
}

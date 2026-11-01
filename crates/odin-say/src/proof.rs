//! JSONL delivery-proof log: one object per attempt, append-only.
//!
//! Field names follow the ODIN "CMUX Delivery Proof" object. Every record carries
//! `record_kind`: `delivery` for a send (text was submitted, whatever the verification
//! said) and `send_refusal` for a pre-send refusal (nothing was typed into the pane), so a
//! refusal can never be read as a delivery.

use crate::say::{surface_locator, Outcome};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;

/// The record attests a send.
pub const RECORD_KIND_DELIVERY: &str = "delivery";
/// The record is a pre-send refusal; nothing was submitted.
pub const RECORD_KIND_SEND_REFUSAL: &str = "send_refusal";

/// Exit code: the proof log could not be proven writable, so nothing was sent.
pub const EXIT_PROOF_LOG_UNWRITABLE: i32 = 8;
/// Exit code: the send happened but its record could not be written.
pub const EXIT_PROOF_RECORD_LOST: i32 = 9;

/// The typed reason printed with [`EXIT_PROOF_LOG_UNWRITABLE`].
pub const PROOF_LOG_UNWRITABLE: &str = "PROOF_LOG_UNWRITABLE";
/// The typed reason printed with [`EXIT_PROOF_RECORD_LOST`].
pub const PROOF_RECORD_LOST: &str = "PROOF_RECORD_LOST";

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProofEntry {
    pub record_kind: String,
    pub timestamp: String,
    pub subcommand: String,
    pub target_surface_locator: String,
    pub submitted: bool,
    pub verification_method: String,
    pub observed_processing_state: String,
    pub sender_role: String,
    pub note: String,
    /// Pre-send pane reads this attempt made.
    pub polls: u32,
    /// Milliseconds spent waiting for a busy pane.
    pub waited_ms: u64,
    /// Harness identity the mid-turn policy was selected from.
    pub harness: String,
    /// How that identity was obtained: flag, env, detected or unknown.
    pub harness_source: String,
    /// A queue-harness send whose read-back showed the text in the queue region.
    pub queued: bool,
}

impl ProofEntry {
    /// Build the record for one outcome. `now` is injected so tests stay deterministic.
    pub fn for_outcome(
        subcommand: &str,
        surface: &str,
        outcome: &Outcome,
        sender_role: &str,
        now: String,
    ) -> Self {
        let record_kind = if outcome.submitted {
            RECORD_KIND_DELIVERY
        } else {
            RECORD_KIND_SEND_REFUSAL
        };
        Self {
            record_kind: record_kind.into(),
            timestamp: now,
            subcommand: subcommand.into(),
            target_surface_locator: surface_locator(surface),
            submitted: outcome.submitted,
            verification_method: "read_screen".into(),
            observed_processing_state: outcome.state.as_str().into(),
            sender_role: sender_role.into(),
            note: outcome.note.into(),
            polls: outcome.polls,
            waited_ms: outcome.waited_ms,
            harness: outcome.harness.harness.clone(),
            harness_source: outcome.harness.source.as_str().into(),
            queued: outcome.queued,
        }
    }
}

/// Prove the proof log writable BEFORE any pane is read or typed into: create the parent
/// directories and open the log for append (nothing is written). A sender that cannot record
/// an attempt must not make the attempt, because a delivery with no record is
/// indistinguishable from a recorded delivery.
pub fn preflight(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_file| ())
}

/// Append one record, creating the log's directory on first write. The JSON and its trailing
/// newline are serialized into ONE buffer and written with a single `write_all` on an O_APPEND
/// handle, so concurrent senders sharing a log cannot interleave a line.
pub fn append(path: &Path, entry: &ProofEntry) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    let mut buffer = serde_json::to_vec(entry)?;
    buffer.push(b'\n');
    file.write_all(&buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::say::DeliveryState;

    fn outcome(submitted: bool, state: DeliveryState, note: &'static str) -> Outcome {
        Outcome {
            state,
            submitted,
            note,
            exit: 0,
            polls: 1,
            waited_ms: 0,
            queued: false,
            harness: crate::identity::HarnessIdentity::unknown(),
        }
    }

    #[test]
    fn a_send_record_is_a_delivery() {
        let entry = ProofEntry::for_outcome(
            "say",
            "surface:7",
            &outcome(true, DeliveryState::DeliveredAcked, "echoed"),
            "EXEC PM",
            "2026-10-31T00:00:00Z".into(),
        );
        assert_eq!(entry.record_kind, RECORD_KIND_DELIVERY);
        assert_eq!(entry.target_surface_locator, "surface:7");
    }

    #[test]
    fn a_pre_send_refusal_is_a_send_refusal() {
        let entry = ProofEntry::for_outcome(
            "say",
            "7",
            &outcome(false, DeliveryState::PaneStillThinking, "pre-send"),
            "EXEC PM",
            "2026-10-31T00:00:00Z".into(),
        );
        assert_eq!(entry.record_kind, RECORD_KIND_SEND_REFUSAL);
        assert!(!entry.submitted);
    }
}

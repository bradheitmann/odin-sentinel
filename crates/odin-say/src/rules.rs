//! Pane rules as data: [`PaneRules`] is parsed from `pane-rules.json`, embedded at build
//! time. `--pane-rules <file>` / `ODIN_SAY_PANE_RULES` swaps in another copy without a
//! rebuild. No rule is hard-coded in the sender: the busy, blocked, spinner, overlay and
//! harness-detection vocabulary all lives in that file.

use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;

/// The embedded rules. Parsed and shape-checked by [`PaneRules::embedded`].
pub const DEFAULT_PANE_RULES_JSON: &str = include_str!("../pane-rules.json");

/// The only schema this crate understands.
pub const PANE_RULES_SCHEMA: &str = "odin-say/pane-rules/1";

/// What a busy pane means for one harness.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MidTurn {
    /// The harness buffers text typed mid-turn and delivers it as a queued steer.
    Queue,
    /// The harness may not buffer: wait for idle, then refuse if it is still busy.
    Refuse,
}

/// Per-harness identity and mid-turn policy.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct HarnessRules {
    /// Literal footer/chrome markers that identify this harness.
    pub detect: Vec<String>,
    pub mid_turn: MidTurn,
    /// Literal markers that show sent text sitting in this harness's queue/steer region.
    pub queue_evidence: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct PaneRules {
    pub schema: String,
    /// Literal strings that mark a live status line (spinner companions).
    pub status_markers: Vec<String>,
    /// Literal words that indicate work in progress.
    pub busy_words: Vec<String>,
    /// Literal fragments whose presence on a line cancels that line's busy match.
    pub busy_exclusions: Vec<String>,
    /// Spinner glyphs; a glyph followed by a space counts as a live spinner.
    pub spinner_glyphs: String,
    /// Literal blocked prompts / overlays.
    pub blocked: Vec<String>,
    /// Literal fragments whose presence on a line cancels that line's blocked match.
    pub blocked_exclusions: Vec<String>,
    /// The one overlay that may be dismissed with Escape and retried.
    pub dismissible_overlay: String,
    /// Per-harness identity and mid-turn policy (BTreeMap keeps detection order stable).
    pub harnesses: BTreeMap<String, HarnessRules>,
    /// How many trailing non-empty lines count as live status (scrollback is not).
    pub live_tail_non_empty_lines: usize,
}

impl PaneRules {
    /// Parse and shape-check rules JSON.
    pub fn parse(json: &str) -> anyhow::Result<Self> {
        let rules: Self = serde_json::from_str(json)?;
        if rules.schema != PANE_RULES_SCHEMA {
            anyhow::bail!(
                "pane rules schema is {:?}, expected {:?}",
                rules.schema,
                PANE_RULES_SCHEMA
            );
        }
        for (name, list) in [
            ("status_markers", &rules.status_markers),
            ("busy_words", &rules.busy_words),
            ("blocked", &rules.blocked),
        ] {
            if list.is_empty() {
                anyhow::bail!("pane rules field {name} must not be empty");
            }
        }
        if rules.harnesses.is_empty() {
            anyhow::bail!("pane rules field harnesses must not be empty");
        }
        for (name, harness) in &rules.harnesses {
            if harness.detect.is_empty() {
                anyhow::bail!("harness {name} must declare at least one detect marker");
            }
            // Fail closed: a queue policy without evidence markers could never be
            // proven on the read-back, so it is refused at parse time.
            if harness.mid_turn == MidTurn::Queue && harness.queue_evidence.is_empty() {
                anyhow::bail!(
                    "harness {name} has mid_turn queue but no queue_evidence markers; a \
                     queue policy must be provable on the read-back"
                );
            }
        }
        if rules.spinner_glyphs.trim().is_empty() {
            anyhow::bail!("pane rules field spinner_glyphs must not be empty");
        }
        if rules.live_tail_non_empty_lines == 0 {
            anyhow::bail!("pane rules field live_tail_non_empty_lines must be at least 1");
        }
        Ok(rules)
    }

    /// Mid-turn policy for a harness name. An unnamed or unknown harness refuses.
    pub fn mid_turn_for(&self, harness: &str) -> MidTurn {
        self.harnesses
            .get(harness)
            .map(|rules| rules.mid_turn)
            .unwrap_or(MidTurn::Refuse)
    }

    /// Queue-evidence markers for a harness (empty when it is not a queue harness).
    pub fn queue_evidence_for(&self, harness: &str) -> &[String] {
        self.harnesses
            .get(harness)
            .map(|rules| rules.queue_evidence.as_slice())
            .unwrap_or(&[])
    }

    /// First harness (in table order) whose detect markers appear on the screen.
    pub fn detect_harness(&self, screen: &str) -> Option<&str> {
        self.harnesses.iter().find_map(|(name, rules)| {
            rules
                .detect
                .iter()
                .any(|marker| screen.contains(marker))
                .then_some(name.as_str())
        })
    }

    /// Load a rules file from disk (the `--pane-rules` override).
    pub fn from_path(path: &Path) -> anyhow::Result<Self> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("reading pane rules {}: {e}", path.display()))?;
        Self::parse(&text)
    }

    /// The embedded rules, parsed once.
    pub fn embedded() -> &'static Self {
        static RULES: OnceLock<PaneRules> = OnceLock::new();
        RULES.get_or_init(|| {
            PaneRules::parse(DEFAULT_PANE_RULES_JSON).expect("embedded pane-rules.json is valid")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_rules_parse() {
        let rules = PaneRules::embedded();
        assert_eq!(rules.schema, PANE_RULES_SCHEMA);
        assert!(rules.busy_words.iter().any(|w| w == "Thinking"));
        assert!(rules
            .blocked_exclusions
            .iter()
            .any(|w| w == "bypass permissions"));
        assert_eq!(rules.live_tail_non_empty_lines, 3);
        assert_eq!(rules.mid_turn_for("pi"), MidTurn::Queue);
        for harness in ["claude-code", "codex", "opencode", "unknown"] {
            assert_eq!(rules.mid_turn_for(harness), MidTurn::Refuse, "{harness}");
        }
        assert!(!rules.queue_evidence_for("pi").is_empty());
        assert!(rules.queue_evidence_for("codex").is_empty());
    }

    #[test]
    fn a_queue_policy_without_evidence_is_refused() {
        let mut value: serde_json::Value =
            serde_json::from_str(DEFAULT_PANE_RULES_JSON).expect("json");
        value["harnesses"]["pi"]["queue_evidence"] = serde_json::json!([]);
        let err = PaneRules::parse(&value.to_string()).expect_err("queue without evidence refused");
        assert!(format!("{err}").contains("queue_evidence"));
    }

    #[test]
    fn detection_follows_the_table_order() {
        let rules = PaneRules::embedded();
        assert_eq!(
            rules.detect_harness("› Ask Codex to do anything"),
            Some("codex")
        );
        assert_eq!(rules.detect_harness("  ctrl+p commands"), Some("opencode"));
        assert_eq!(
            rules.detect_harness("  ⏵⏵ bypass permissions on"),
            Some("claude-code")
        );
        assert_eq!(rules.detect_harness("↑12k ↓3k"), Some("pi"));
        assert_eq!(rules.detect_harness("plain text"), None);
    }

    #[test]
    fn a_foreign_schema_is_refused() {
        let mut value: serde_json::Value =
            serde_json::from_str(DEFAULT_PANE_RULES_JSON).expect("json");
        value["schema"] = serde_json::json!("someone-else/rules");
        let err = PaneRules::parse(&value.to_string()).expect_err("schema refused");
        assert!(format!("{err}").contains("schema"));
    }

    #[test]
    fn empty_rule_lists_are_refused() {
        let mut value: serde_json::Value =
            serde_json::from_str(DEFAULT_PANE_RULES_JSON).expect("json");
        value["busy_words"] = serde_json::json!([]);
        let err = PaneRules::parse(&value.to_string()).expect_err("empty list refused");
        assert!(format!("{err}").contains("busy_words"));
    }
}

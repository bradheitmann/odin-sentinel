//! Harness identity: `--harness`, then `ODIN_SAY_HARNESS`, then footer detection.
//!
//! An undetected pane is `unknown` and refuses a busy mid-turn, which is the safe default:
//! only a harness with captured queue evidence may be typed into while busy.

use crate::rules::PaneRules;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarnessSource {
    Flag,
    Env,
    Detected,
    Unknown,
}

impl HarnessSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Flag => "flag",
            Self::Env => "env",
            Self::Detected => "detected",
            Self::Unknown => "unknown",
        }
    }
}

/// How the caller asked for a harness: flag first, then environment. Detection is the
/// fallback and needs the pane.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct HarnessSelector {
    pub flag: Option<String>,
    pub env: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessIdentity {
    pub harness: String,
    pub source: HarnessSource,
}

impl HarnessIdentity {
    pub fn unknown() -> Self {
        Self {
            harness: "unknown".into(),
            source: HarnessSource::Unknown,
        }
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.trim().is_empty())
}

/// Resolve the harness: explicit flag, then environment, then what the pane shows.
/// A name given by flag or environment is preserved even when the rules table does not
/// know it; its policy is then the refuse default.
pub fn identify(
    flag: Option<&str>,
    env: Option<&str>,
    screen: &str,
    rules: &PaneRules,
) -> HarnessIdentity {
    if let Some(name) = non_empty(flag) {
        return HarnessIdentity {
            harness: name.trim().to_string(),
            source: HarnessSource::Flag,
        };
    }
    if let Some(name) = non_empty(env) {
        return HarnessIdentity {
            harness: name.trim().to_string(),
            source: HarnessSource::Env,
        };
    }
    match rules.detect_harness(screen) {
        Some(name) => HarnessIdentity {
            harness: name.to_string(),
            source: HarnessSource::Detected,
        },
        None => HarnessIdentity::unknown(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_beats_environment_beats_detection() {
        let rules = PaneRules::embedded();
        let codex_screen = "› Ask Codex to do anything";
        let from_flag = identify(Some("pi"), Some("codex"), codex_screen, rules);
        assert_eq!(from_flag.harness, "pi");
        assert_eq!(from_flag.source, HarnessSource::Flag);
        let from_env = identify(None, Some("opencode"), codex_screen, rules);
        assert_eq!(from_env.harness, "opencode");
        assert_eq!(from_env.source, HarnessSource::Env);
        let detected = identify(None, None, codex_screen, rules);
        assert_eq!(detected.harness, "codex");
        assert_eq!(detected.source, HarnessSource::Detected);
        let unknown = identify(None, None, "nothing familiar here", rules);
        assert_eq!(unknown.harness, "unknown");
        assert_eq!(unknown.source, HarnessSource::Unknown);
    }

    #[test]
    fn an_unknown_explicit_name_is_kept_and_refuses() {
        let rules = PaneRules::embedded();
        let identity = identify(Some("mystery"), None, "", rules);
        assert_eq!(identity.harness, "mystery");
        assert_eq!(identity.source, HarnessSource::Flag);
        assert_eq!(
            rules.mid_turn_for(&identity.harness),
            crate::rules::MidTurn::Refuse
        );
    }
}

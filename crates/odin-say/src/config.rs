//! Configuration resolution: flag, then environment, then a cloud-friendly default.
//!
//! The proof log defaults to `$XDG_STATE_HOME/odin/delivery-proof.jsonl`, falling back to
//! `~/.local/state/odin/delivery-proof.jsonl`. No home path, machine name or team directory
//! is baked into the code; the environment supplies them. Resolution takes the environment
//! as a lookup function so tests exercise precedence without touching the process
//! environment.

use std::path::{Path, PathBuf};
use std::time::Duration;

pub const DEFAULT_SENDER_ROLE: &str = "EXEC PM";
pub const DEFAULT_CMUX_BINARY: &str = "cmux";
pub const DEFAULT_POLL_SECS: u64 = 5;
pub const DEFAULT_WAIT_SECS: u64 = 180;

/// Flag values for one invocation (all optional).
#[derive(Debug, Default, Clone)]
pub struct ConfigFlags {
    pub proof: Option<PathBuf>,
    pub sender_role: Option<String>,
    pub pane_rules: Option<PathBuf>,
    pub poll_secs: Option<u64>,
    pub wait_secs: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub proof_path: PathBuf,
    pub sender_role: String,
    pub pane_rules_path: Option<PathBuf>,
    pub cmux_binary: String,
    pub poll: Duration,
    pub wait: Duration,
}

fn env_value(env: &dyn Fn(&str) -> Option<String>, name: &str) -> Option<String> {
    env(name).filter(|value| !value.is_empty())
}

/// Default proof log for a cloud machine: XDG state home first, then the local state dir.
fn default_proof_path(env: &dyn Fn(&str) -> Option<String>) -> PathBuf {
    if let Some(state) = env_value(env, "XDG_STATE_HOME") {
        return Path::new(&state).join("odin").join("delivery-proof.jsonl");
    }
    if let Some(home) = env_value(env, "HOME") {
        return Path::new(&home)
            .join(".local")
            .join("state")
            .join("odin")
            .join("delivery-proof.jsonl");
    }
    PathBuf::from("odin").join("delivery-proof.jsonl")
}

impl Config {
    pub fn resolve(flags: &ConfigFlags, env: &dyn Fn(&str) -> Option<String>) -> Self {
        let proof_path = flags
            .proof
            .clone()
            .or_else(|| env_value(env, "ODIN_SAY_PROOF").map(PathBuf::from))
            .unwrap_or_else(|| default_proof_path(env));
        let sender_role = flags
            .sender_role
            .clone()
            .or_else(|| env_value(env, "ODIN_SAY_SENDER_ROLE"))
            .unwrap_or_else(|| DEFAULT_SENDER_ROLE.into());
        let pane_rules_path = flags
            .pane_rules
            .clone()
            .or_else(|| env_value(env, "ODIN_SAY_PANE_RULES").map(PathBuf::from));
        let cmux_binary =
            env_value(env, "ODIN_SAY_CMUX").unwrap_or_else(|| DEFAULT_CMUX_BINARY.into());
        Self {
            proof_path,
            sender_role,
            pane_rules_path,
            cmux_binary,
            poll: Duration::from_secs(flags.poll_secs.unwrap_or(DEFAULT_POLL_SECS)),
            wait: Duration::from_secs(flags.wait_secs.unwrap_or(DEFAULT_WAIT_SECS)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        move |key: &str| map.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }

    #[test]
    fn flags_beat_environment() {
        let env = env_of(&[
            ("ODIN_SAY_PROOF", "/tmp/env-proof.jsonl"),
            ("ODIN_SAY_SENDER_ROLE", "ENV PM"),
            ("ODIN_SAY_CMUX", "env-cmux"),
        ]);
        let flags = ConfigFlags {
            proof: Some(PathBuf::from("/tmp/flag-proof.jsonl")),
            sender_role: Some("FLAG PM".into()),
            ..Default::default()
        };
        let config = Config::resolve(&flags, &env);
        assert_eq!(config.proof_path, PathBuf::from("/tmp/flag-proof.jsonl"));
        assert_eq!(config.sender_role, "FLAG PM");
        assert_eq!(config.cmux_binary, "env-cmux");
    }

    #[test]
    fn environment_beats_the_defaults() {
        let env = env_of(&[
            ("ODIN_SAY_PROOF", "/tmp/env-proof.jsonl"),
            ("ODIN_SAY_SENDER_ROLE", "ENV PM"),
            ("ODIN_SAY_CMUX", "env-cmux"),
            ("ODIN_SAY_PANE_RULES", "/tmp/rules.json"),
        ]);
        let config = Config::resolve(&ConfigFlags::default(), &env);
        assert_eq!(config.proof_path, PathBuf::from("/tmp/env-proof.jsonl"));
        assert_eq!(config.sender_role, "ENV PM");
        assert_eq!(config.cmux_binary, "env-cmux");
        assert_eq!(
            config.pane_rules_path,
            Some(PathBuf::from("/tmp/rules.json"))
        );
    }

    #[test]
    fn the_cloud_default_uses_xdg_state_home() {
        let env = env_of(&[
            ("XDG_STATE_HOME", "/var/lib/state"),
            ("HOME", "/home/someone"),
        ]);
        let config = Config::resolve(&ConfigFlags::default(), &env);
        assert_eq!(
            config.proof_path,
            PathBuf::from("/var/lib/state/odin/delivery-proof.jsonl")
        );
        assert_eq!(config.sender_role, DEFAULT_SENDER_ROLE);
        assert_eq!(config.cmux_binary, DEFAULT_CMUX_BINARY);
        assert_eq!(config.poll, Duration::from_secs(5));
        assert_eq!(config.wait, Duration::from_secs(180));
        assert_eq!(config.pane_rules_path, None);
    }

    #[test]
    fn the_local_state_fallback_is_used_without_xdg() {
        let env = env_of(&[("HOME", "/home/someone")]);
        let config = Config::resolve(&ConfigFlags::default(), &env);
        assert_eq!(
            config.proof_path,
            PathBuf::from("/home/someone/.local/state/odin/delivery-proof.jsonl")
        );
    }

    #[test]
    fn empty_environment_values_are_unset() {
        let env = env_of(&[("ODIN_SAY_SENDER_ROLE", ""), ("XDG_STATE_HOME", "")]);
        let config = Config::resolve(&ConfigFlags::default(), &env);
        assert_eq!(config.sender_role, DEFAULT_SENDER_ROLE);
        assert_eq!(
            config.proof_path,
            PathBuf::from("odin").join("delivery-proof.jsonl")
        );
    }

    #[test]
    fn poll_and_wait_come_from_flags() {
        let env = env_of(&[]);
        let flags = ConfigFlags {
            poll_secs: Some(2),
            wait_secs: Some(9),
            ..Default::default()
        };
        let config = Config::resolve(&flags, &env);
        assert_eq!(config.poll, Duration::from_secs(2));
        assert_eq!(config.wait, Duration::from_secs(9));
    }
}

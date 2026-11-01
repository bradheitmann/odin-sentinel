//! CMUX delivery (SCP "CMUX Delivery Proof"), sender side.
//!
//! Doctrine: a dispatch is not delivered until submitted with Enter AND processing is
//! verified on the target by reading the pane. Proof states: DELIVERED_ACKED |
//! DELIVERED_NO_ACK | INPUT_BAR_ONLY | PANE_BLOCKED_ON_PERMISSION | PANE_STILL_THINKING.
//! Exit 0 only for DELIVERED_*.
//!
//! Submit profile: flatten to ONE line, one Enter, read back, re-Enter ONCE only if the
//! input bar still shows the message. Pre-send classification refuses blocked panes at once
//! and WAITS on a busy pane under a wall-clock budget (monotonic clock, poll interval), so
//! two agents replying through the sender cannot starve each other with instant refusals.

use crate::clock::Clock;
use crate::cmux::Cmux;
use crate::identity::{identify, HarnessIdentity, HarnessSelector};
use crate::rules::{MidTurn, PaneRules};
use serde::Serialize;
use std::time::Duration;

/// Exit codes, one per outcome class.
pub const EXIT_DELIVERED: i32 = 0;
pub const EXIT_BLOCKED: i32 = 2;
pub const EXIT_STILL_THINKING: i32 = 3;
pub const EXIT_STALE_STUCK: i32 = 4;
pub const EXIT_SEND_FAILED: i32 = 5;
pub const EXIT_STUCK_AFTER_ENTERS: i32 = 6;
/// A queue-harness send whose read-back never showed the text in the queue region.
pub const EXIT_QUEUE_UNPROVEN: i32 = 7;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeliveryState {
    DeliveredAcked,
    DeliveredNoAck,
    InputBarOnly,
    PaneBlockedOnPermission,
    PaneStillThinking,
}

impl DeliveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DeliveredAcked => "DELIVERED_ACKED",
            Self::DeliveredNoAck => "DELIVERED_NO_ACK",
            Self::InputBarOnly => "INPUT_BAR_ONLY",
            Self::PaneBlockedOnPermission => "PANE_BLOCKED_ON_PERMISSION",
            Self::PaneStillThinking => "PANE_STILL_THINKING",
        }
    }

    pub fn delivered(self) -> bool {
        matches!(self, Self::DeliveredAcked | Self::DeliveredNoAck)
    }
}

/// What the pre-send read says about a pane.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaneState {
    Blocked,
    Busy,
    StaleInput,
    Idle,
}

impl PaneState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blocked => "blocked",
            Self::Busy => "busy",
            Self::StaleInput => "stale_input",
            Self::Idle => "idle",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub state: DeliveryState,
    pub submitted: bool,
    pub note: &'static str,
    pub exit: i32,
    /// Pre-send pane reads this attempt made (the wait polls plus the first read).
    pub polls: u32,
    /// Milliseconds spent waiting for a busy pane to become idle.
    pub waited_ms: u64,
    /// The send went into a queue harness mid-turn and the read-back showed it queued.
    pub queued: bool,
    /// The harness identity the mid-turn policy was selected from.
    pub harness: HarnessIdentity,
}

/// Wait policy for a busy pane: re-read every `poll`, giving up after `wait`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeliveryOptions {
    pub poll: Duration,
    pub wait: Duration,
}

impl Default for DeliveryOptions {
    fn default() -> Self {
        Self {
            poll: Duration::from_secs(5),
            wait: Duration::from_secs(180),
        }
    }
}

/// Keep the last 14 lines (the sender only reasons about that tail).
pub fn tail14(raw: &str) -> String {
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(14);
    lines[start..].join("\n")
}

/// A spinner glyph followed by a space (a glyph at the end of a word is not a spinner).
fn has_spinner(line: &str, rules: &PaneRules) -> bool {
    let chars: Vec<char> = line.chars().collect();
    chars
        .windows(2)
        .any(|w| rules.spinner_glyphs.contains(w[0]) && w[1] == ' ')
}

fn line_has_busy_word(line: &str, rules: &PaneRules) -> bool {
    rules.busy_words.iter().any(|p| line.contains(p))
}

fn line_excluded(line: &str, exclusions: &[String]) -> bool {
    exclusions.iter().any(|p| line.contains(p))
}

/// Live status lines are the last N non-empty lines of the pane tail.
fn live_line_indexes(lines: &[&str], live_tail: usize) -> Vec<usize> {
    let mut indexes = Vec::with_capacity(live_tail);
    let mut seen = 0;
    for (index, line) in lines.iter().enumerate().rev() {
        if line.trim().is_empty() {
            continue;
        }
        indexes.push(index);
        seen += 1;
        if seen >= live_tail {
            break;
        }
    }
    indexes
}

fn busy_line_is_live(line: &str, index: usize, live: &[usize], rules: &PaneRules) -> bool {
    live.contains(&index)
        || has_spinner(line, rules)
        || rules.status_markers.iter().any(|m| line.contains(m))
}

/// A spinner glyph is live activity on its own. A busy WORD only marks a pane busy on a
/// LIVE line: one that also carries a spinner glyph or a harness status marker, or one of
/// the last few non-empty lines. Leftover scrollback therefore never reads as busy (the
/// field's false PANE_STILL_THINKING).
pub fn busy(screen: &str, rules: &PaneRules) -> bool {
    let lines: Vec<&str> = screen.lines().collect();
    let live = live_line_indexes(&lines, rules.live_tail_non_empty_lines);
    lines.iter().enumerate().any(|(index, line)| {
        !line_excluded(line, &rules.busy_exclusions)
            && (has_spinner(line, rules)
                || (line_has_busy_word(line, rules)
                    && busy_line_is_live(line, index, &live, rules)))
    })
}

/// A blocked pane: an overlay or permission prompt. Ambient permission-status lines are
/// ignored (they are a footer, not a prompt).
pub fn blocked(screen: &str, rules: &PaneRules) -> bool {
    screen
        .lines()
        .filter(|line| !line_excluded(line, &rules.blocked_exclusions))
        .any(|line| rules.blocked.iter().any(|p| line.contains(p)))
}

/// Harnesses that queue sent text while busy show it in a queue region (for pi: a
/// `Steering: <text>` line followed by the queued-messages hint). The read-back proves the
/// queueing only when the sent text (its flattened head) and a harness queue-evidence marker
/// appear on the SAME line: a stale `Steering:` line elsewhere on the pane, or the text still
/// sitting in the input bar, is not evidence.
pub fn shows_queued(screen: &str, flat: &str, rules: &PaneRules, harness: &str) -> bool {
    let head: String = flat.chars().take(40).collect();
    if head.trim().is_empty() {
        return false;
    }
    let evidence = rules.queue_evidence_for(harness);
    if evidence.is_empty() {
        return false;
    }
    screen.lines().any(|line| {
        line.contains(head.as_str()) && evidence.iter().any(|marker| line.contains(marker.as_str()))
    })
}

/// Only the LAST prompt-glyph line is the input bar; earlier ones are the harness echo of
/// already-submitted messages.
pub fn input_bar(screen: &str) -> Option<&str> {
    screen
        .lines()
        .rev()
        .find(|l| l.starts_with("› ") || l.starts_with("❯ "))
}

pub fn stale_input(screen: &str) -> bool {
    let Some(bar) = input_bar(screen) else {
        return false;
    };
    // Glyph, one space, then a non-space character.
    let mut chars = bar.chars();
    let _glyph = chars.next();
    let _space = chars.next();
    let starts_with_text = chars.next().is_some_and(|c| !c.is_whitespace());
    starts_with_text && !bar.contains("Ask Codex") && !bar.contains("Press up to edit")
}

/// Classify in the order the sender acts: blocked, busy, stale input, idle.
pub fn classify(screen: &str, rules: &PaneRules) -> PaneState {
    if blocked(screen, rules) {
        PaneState::Blocked
    } else if busy(screen, rules) {
        PaneState::Busy
    } else if stale_input(screen) {
        PaneState::StaleInput
    } else {
        PaneState::Idle
    }
}

/// Harnesses echo the submitted text as a history line with the same prompt glyph: if a
/// response line (filled bullet) or a fresh empty prompt appears AFTER that echo, the
/// message went in even though the text is still visible.
pub fn answered(screen: &str, head: &str) -> bool {
    let mut seen = false;
    for line in screen.lines() {
        if !head.is_empty() && line.contains(head) {
            seen = true;
            continue;
        }
        if seen && is_response_or_fresh_prompt(line) {
            return true;
        }
    }
    false
}

fn is_response_or_fresh_prompt(line: &str) -> bool {
    if line.starts_with('⏺') || line.starts_with('•') {
        return true;
    }
    for glyph in ['›', '❯'] {
        if let Some(rest) = line.strip_prefix(glyph) {
            if rest.chars().all(|c| c == ' ') {
                return true;
            }
        }
    }
    false
}

/// One line: tabs/newlines/returns become spaces, runs of spaces collapse.
pub fn flatten(text: &str) -> String {
    let spaced: String = text
        .chars()
        .map(|c| {
            if matches!(c, '\n' | '\r' | '\t') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut out = String::with_capacity(spaced.len());
    let mut last_space = false;
    for c in spaced.chars() {
        if c == ' ' {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
        } else {
            out.push(c);
            last_space = false;
        }
    }
    out
}

pub fn surface_locator(id: &str) -> String {
    let bare = id.strip_prefix("surface:").unwrap_or(id);
    format!("surface:{bare}")
}

fn refuse(
    state: DeliveryState,
    submitted: bool,
    note: &'static str,
    exit: i32,
    polls: u32,
    waited_ms: u64,
) -> Outcome {
    Outcome {
        state,
        submitted,
        note,
        exit,
        polls,
        waited_ms,
        queued: false,
        harness: HarnessIdentity::unknown(),
    }
}

fn delivered(state: DeliveryState, note: &'static str, polls: u32, waited_ms: u64) -> Outcome {
    Outcome {
        state,
        submitted: true,
        note,
        exit: EXIT_DELIVERED,
        polls,
        waited_ms,
        queued: false,
        harness: HarnessIdentity::unknown(),
    }
}

/// Delivered into a queue harness mid-turn: submitted, still processing, and the read-back
/// showed the text in the harness's queue/steer region.
fn queued(note: &'static str, polls: u32) -> Outcome {
    Outcome {
        state: DeliveryState::PaneStillThinking,
        submitted: true,
        note,
        exit: EXIT_DELIVERED,
        polls,
        waited_ms: 0,
        queued: true,
        harness: HarnessIdentity::unknown(),
    }
}

/// Deliver `text` to the pane. `surface` is the full locator (`surface:<id>`). `identity`
/// selects the mid-turn policy: a queue harness is typed into while busy and must show the
/// text in its queue region on the read-back; every other harness waits (slice 1) and then
/// refuses.
pub fn deliver(
    cmux: &dyn Cmux,
    clock: &dyn Clock,
    rules: &PaneRules,
    selector: &HarnessSelector,
    surface: &str,
    text: &str,
    opts: &DeliveryOptions,
) -> Outcome {
    let flat = flatten(text);
    let poll_ms = u64::try_from(opts.poll.as_millis())
        .unwrap_or(u64::MAX)
        .max(1);
    let budget_ms = u64::try_from(opts.wait.as_millis()).unwrap_or(u64::MAX);
    let mut polls: u32 = 1;
    // Wall-clock time from the first busy observation to the send or refusal decision,
    // measured on the monotonic clock so screen-read time counts too (not just sleeps).
    let mut first_busy_at: Option<u64> = None;
    let mut waited_ms: u64 = 0;
    let mut screen = tail14(&cmux.read_screen(surface));
    // Identity is resolved against the pane itself when no flag or environment says.
    let identity = identify(
        selector.flag.as_deref(),
        selector.env.as_deref(),
        &screen,
        rules,
    );

    let outcome = (|| {
        if blocked(&screen, rules) {
            if screen.contains(rules.dismissible_overlay.as_str()) {
                // The overlay is dismissible: Escape, wait, re-read, proceed.
                cmux.send_key(surface, "Escape");
                clock.sleep(Duration::from_secs(1));
                screen = tail14(&cmux.read_screen(surface));
                polls += 1;
            } else {
                return refuse(
                    DeliveryState::PaneBlockedOnPermission,
                    false,
                    "pre-send",
                    EXIT_BLOCKED,
                    polls,
                    waited_ms,
                );
            }
        }

        if busy(&screen, rules) {
            first_busy_at = Some(clock.elapsed_ms());
            match rules.mid_turn_for(&identity.harness) {
                MidTurn::Queue => {
                    // Pi accepts text mid-turn and delivers it as a queued steer: send now,
                    // exactly one Enter, and require queue evidence on the read-back.
                    waited_ms = clock.elapsed_ms() - first_busy_at.unwrap_or(0);
                    if !cmux.send_text(surface, &flat) {
                        return refuse(
                            DeliveryState::InputBarOnly,
                            false,
                            "send-failed",
                            EXIT_SEND_FAILED,
                            polls,
                            waited_ms,
                        );
                    }
                    clock.sleep(Duration::from_millis(1500));
                    cmux.send_key(surface, "Enter");
                    clock.sleep(Duration::from_secs(3));
                    let read_back = tail14(&cmux.read_screen(surface));
                    if shows_queued(&read_back, &flat, rules, &identity.harness) {
                        return queued("queued", polls);
                    }
                    // No second Enter: an unproven queue send is not a delivery.
                    return refuse(
                        DeliveryState::InputBarOnly,
                        true,
                        "queue-not-proven",
                        EXIT_QUEUE_UNPROVEN,
                        polls,
                        waited_ms,
                    );
                }
                MidTurn::Refuse => {
                    // Bounded wait: poll until the pane is idle or the wall-clock budget is spent.
                    loop {
                        let busy_at = first_busy_at.unwrap_or(0);
                        let waited = clock.elapsed_ms() - busy_at;
                        if waited >= budget_ms {
                            break;
                        }
                        let step = poll_ms.min(budget_ms - waited);
                        clock.sleep(Duration::from_millis(step));
                        screen = tail14(&cmux.read_screen(surface));
                        polls += 1;
                        if !busy(&screen, rules) {
                            break;
                        }
                    }
                    waited_ms = clock.elapsed_ms() - first_busy_at.unwrap_or(0);
                    if busy(&screen, rules) {
                        return refuse(
                            DeliveryState::PaneStillThinking,
                            false,
                            "pre-send",
                            EXIT_STILL_THINKING,
                            polls,
                            waited_ms,
                        );
                    }
                }
            }
        }

        if stale_input(&screen) {
            cmux.send_key(surface, "Enter");
            clock.sleep(Duration::from_secs(3));
            screen = tail14(&cmux.read_screen(surface));
            if stale_input(&screen) {
                return refuse(
                    DeliveryState::InputBarOnly,
                    false,
                    "stale-text-stuck",
                    EXIT_STALE_STUCK,
                    polls,
                    waited_ms,
                );
            }
        }

        if !cmux.send_text(surface, &flat) {
            return refuse(
                DeliveryState::InputBarOnly,
                false,
                "send-failed",
                EXIT_SEND_FAILED,
                polls,
                waited_ms,
            );
        }
        clock.sleep(Duration::from_millis(1500));
        cmux.send_key(surface, "Enter");
        clock.sleep(Duration::from_secs(3));
        screen = tail14(&cmux.read_screen(surface));

        let head: String = flat.chars().take(40).collect();
        let in_bar = |screen: &str| input_bar(screen).is_some_and(|b| b.contains(head.as_str()));
        if in_bar(&screen) {
            // single_enter_verify: re-Enter ONCE.
            cmux.send_key(surface, "Enter");
            clock.sleep(Duration::from_secs(3));
            screen = tail14(&cmux.read_screen(surface));
            if in_bar(&screen) && !answered(&screen, &head) {
                return refuse(
                    DeliveryState::InputBarOnly,
                    true,
                    "after-2-enters",
                    EXIT_STUCK_AFTER_ENTERS,
                    polls,
                    waited_ms,
                );
            }
        }

        if busy(&screen, rules) || screen.contains("queued messages") {
            delivered(
                DeliveryState::DeliveredNoAck,
                "processing",
                polls,
                waited_ms,
            )
        } else if screen.contains(head.as_str()) {
            delivered(DeliveryState::DeliveredAcked, "echoed", polls, waited_ms)
        } else {
            delivered(
                DeliveryState::DeliveredNoAck,
                "prompt-clear",
                polls,
                waited_ms,
            )
        }
    })();

    Outcome {
        harness: identity,
        ..outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> &'static PaneRules {
        PaneRules::embedded()
    }

    #[test]
    fn flatten_makes_one_line() {
        assert_eq!(flatten("a\nb\tc\r\n  d   e"), "a b c d e");
        assert_eq!(flatten("  x  "), " x ");
    }

    #[test]
    fn tail14_keeps_last_fourteen_lines() {
        let raw: String = (1..=20).map(|n| format!("l{n}\n")).collect();
        let t = tail14(&raw);
        assert_eq!(t.lines().count(), 14);
        assert!(t.starts_with("l7"));
        assert!(t.ends_with("l20"));
    }

    #[test]
    fn spinner_needs_trailing_space() {
        assert!(busy("⠙ reading", rules()));
        assert!(!busy("end⠙", rules()));
        assert!(busy("Working (3s • esc to interrupt)", rules()));
    }

    #[test]
    fn scrollback_busy_words_are_not_live() {
        let screen =
            "Thinking: the user wants the gate\nDone: it is green.\nReady\nctrl+p commands";
        assert!(!busy(screen, rules()));
    }

    #[test]
    fn locator_accepts_bare_prefixed_and_uuid() {
        assert_eq!(surface_locator("12"), "surface:12");
        assert_eq!(surface_locator("surface:12"), "surface:12");
        assert_eq!(surface_locator("3C0D-1A"), "surface:3C0D-1A");
    }

    #[test]
    fn answered_needs_a_response_after_the_echo() {
        assert!(answered("› read this\n⏺ done", "read this"));
        assert!(answered("❯ read this\n•  working\n", "read this"));
        assert!(answered("› read this\n›   ", "read this"));
        assert!(!answered("› read this", "read this"));
        assert!(!answered("⏺ earlier\n› read this", "read this"));
    }
}

#[cfg(test)]
mod queue_evidence_tests {
    use super::*;

    fn rules() -> &'static PaneRules {
        PaneRules::embedded()
    }

    #[test]
    fn queue_evidence_must_be_on_the_same_line_as_the_text() {
        let stale = " Steering: an older steer about something else\n\n› queue this exact line\n\n ↳ Option+Up to edit all queued messages";
        assert!(!shows_queued(stale, "queue this exact line", rules(), "pi"));
        let queued = " Steering: queue this exact line\n ↳ Option+Up to edit all queued messages";
        assert!(shows_queued(queued, "queue this exact line", rules(), "pi"));
        // A harness with no queue evidence can never prove queueing.
        assert!(!shows_queued(
            queued,
            "queue this exact line",
            rules(),
            "codex"
        ));
    }
}

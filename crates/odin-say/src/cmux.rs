//! The only door to the pane multiplexer binary. Everything that touches a pane goes
//! through the [`Cmux`] trait, so tests drive a [`StubCmux`] with scripted screens and the
//! end-to-end test drives a fake binary.
//!
//! `ODIN_SAY_CMUX` overrides the binary path (default `cmux` on `PATH`). Time is not part of
//! this trait: waits go through [`crate::clock::Clock`].

use crate::clock::FakeClock;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::process::{Command, Stdio};
use std::rc::Rc;
use std::time::Duration;

/// A send or key command the multiplexer itself refused: it exited non-zero, was killed by a
/// signal, or could not be run at all. Carries the exit description and the first line of the
/// command's error output, on one line, at most 300 characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportFailure {
    pub detail: String,
}

impl TransportFailure {
    pub fn new(detail: impl Into<String>) -> Self {
        let mut text: String = detail
            .into()
            .lines()
            .next()
            .unwrap_or_default()
            .trim()
            .to_owned();
        if text.chars().count() > 300 {
            text = text.chars().take(300).collect();
        }
        Self { detail: text }
    }
}

impl std::fmt::Display for TransportFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.detail)
    }
}

pub trait Cmux {
    /// Raw pane text for `surface:<id>`; `Err` when the pane could not be read. A failed read
    /// is never an empty pane: the sender refuses instead of typing into a pane it cannot see.
    fn read_screen(&self, surface: &str) -> Result<String, ReadScreenFailed>;
    /// `Err` when the multiplexer refused the send: the caller must report a transport failure,
    /// never a pane state.
    fn send_text(&self, surface: &str, text: &str) -> Result<(), TransportFailure>;
    fn send_key(&self, surface: &str, key: &str) -> Result<(), TransportFailure>;
}

/// A pane read that did not produce text: the binary could not be spawned, or it exited
/// non-zero. Carries the surface and the reason so the refusal can name both.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadScreenFailed {
    pub surface: String,
    pub detail: String,
}

impl std::fmt::Display for ReadScreenFailed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "read-screen failed for {}: {}",
            self.surface, self.detail
        )
    }
}

impl std::error::Error for ReadScreenFailed {}

/// The real binary.
pub struct RealCmux {
    binary: String,
}

impl RealCmux {
    pub fn new(binary: &str) -> Self {
        Self {
            binary: binary.into(),
        }
    }

    fn quiet(&self, args: &[&str]) -> Result<(), TransportFailure> {
        let output = Command::new(&self.binary)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| TransportFailure::new(format!("could not run the binary: {e}")))?;
        if output.status.success() {
            return Ok(());
        }
        let how = match output.status.code() {
            Some(code) => format!("exit {code}"),
            None => "terminated by a signal".to_owned(),
        };
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let first = stderr.lines().next().unwrap_or("").trim();
        Err(TransportFailure::new(if first.is_empty() {
            how
        } else {
            format!("{how}: {first}")
        }))
    }
}

impl Cmux for RealCmux {
    fn read_screen(&self, surface: &str) -> Result<String, ReadScreenFailed> {
        let failed = |detail: String| ReadScreenFailed {
            surface: surface.to_owned(),
            detail,
        };
        let output = Command::new(&self.binary)
            .args(["read-screen", "--surface", surface])
            .stderr(Stdio::null())
            .output()
            .map_err(|e| failed(format!("could not run the binary: {e}")))?;
        if !output.status.success() {
            let how = match output.status.code() {
                Some(code) => format!("exit {code}"),
                None => "terminated by a signal".to_owned(),
            };
            return Err(failed(how));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn send_text(&self, surface: &str, text: &str) -> Result<(), TransportFailure> {
        self.quiet(&["send", "--surface", surface, text])
    }

    fn send_key(&self, surface: &str, key: &str) -> Result<(), TransportFailure> {
        self.quiet(&["send-key", "--surface", surface, key])
    }
}

/// One recorded interaction with the stub.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Call {
    ReadScreen(String),
    SendText(String, String),
    SendKey(String, String),
}

/// Scripted pane multiplexer: `read_screen` pops the next scripted screen (the last one
/// repeats), `send_text`/`send_key` return `ok`. Every call is recorded.
pub struct StubCmux {
    screens: RefCell<VecDeque<String>>,
    last: RefCell<String>,
    pub ok: bool,
    /// The error line a failing stub reports, so tests can assert on transport_error.
    pub error: String,
    /// When set, only key commands fail (the text was typed; the Enter was refused).
    pub keys_fail: bool,
    pub calls: RefCell<Vec<Call>>,
    /// When set, every read advances this fake clock: a read that takes time.
    read_cost: Option<(Rc<FakeClock>, Duration)>,
    /// 1-based read index from which every read fails, modelling a `read-screen` that exits
    /// non-zero (the one case the sender must never mistake for an empty pane).
    fail_reads_from: Option<usize>,
    reads: RefCell<usize>,
}

impl StubCmux {
    pub fn new(screens: &[&str]) -> Self {
        Self {
            screens: RefCell::new(screens.iter().map(|s| (*s).to_string()).collect()),
            last: RefCell::new(String::new()),
            ok: true,
            error: "exit 1: fake multiplexer refused the send".to_owned(),
            keys_fail: false,
            calls: RefCell::new(Vec::new()),
            read_cost: None,
            fail_reads_from: None,
            reads: RefCell::new(0),
        }
    }

    /// Make the `n`th read (1-based) and every later one fail, as a `read-screen` that exits
    /// non-zero does.
    pub fn with_read_failure_from(mut self, n: usize) -> Self {
        self.fail_reads_from = Some(n);
        self
    }

    /// Model a pane read that takes wall time: each `read_screen` advances `clock` by
    /// `cost` without recording a sleep. Used to prove the wait budget measures wall time,
    /// not sleep time.
    pub fn with_read_cost(mut self, clock: Rc<FakeClock>, cost: Duration) -> Self {
        self.read_cost = Some((clock, cost));
        self
    }

    pub fn failing(mut self) -> Self {
        self.ok = false;
        self
    }

    /// Fail only on key commands, with a specific error line.
    pub fn failing_keys(mut self, error: &str) -> Self {
        self.keys_fail = true;
        self.error = error.to_owned();
        self
    }

    /// Fail with a specific error line (exit status plus the multiplexer's own message).
    pub fn failing_with(mut self, error: &str) -> Self {
        self.ok = false;
        self.error = error.to_owned();
        self
    }

    pub fn recorded(&self) -> Vec<Call> {
        self.calls.borrow().clone()
    }

    pub fn keys(&self) -> Vec<String> {
        self.calls
            .borrow()
            .iter()
            .filter_map(|c| match c {
                Call::SendKey(_, k) => Some(k.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn texts(&self) -> Vec<String> {
        self.calls
            .borrow()
            .iter()
            .filter_map(|c| match c {
                Call::SendText(_, t) => Some(t.clone()),
                _ => None,
            })
            .collect()
    }
}

impl Cmux for StubCmux {
    fn read_screen(&self, surface: &str) -> Result<String, ReadScreenFailed> {
        self.calls
            .borrow_mut()
            .push(Call::ReadScreen(surface.into()));
        let index = {
            let mut reads = self.reads.borrow_mut();
            *reads += 1;
            *reads
        };
        if let Some(fail_from) = self.fail_reads_from {
            if index >= fail_from {
                return Err(ReadScreenFailed {
                    surface: surface.into(),
                    detail: "exit 1".into(),
                });
            }
        }
        if let Some(next) = self.screens.borrow_mut().pop_front() {
            *self.last.borrow_mut() = next;
        }
        if let Some((clock, cost)) = &self.read_cost {
            clock.advance(*cost);
        }
        Ok(self.last.borrow().clone())
    }

    fn send_text(&self, surface: &str, text: &str) -> Result<(), TransportFailure> {
        self.calls
            .borrow_mut()
            .push(Call::SendText(surface.into(), text.into()));
        if self.ok {
            Ok(())
        } else {
            Err(TransportFailure::new(self.error.clone()))
        }
    }

    fn send_key(&self, surface: &str, key: &str) -> Result<(), TransportFailure> {
        self.calls
            .borrow_mut()
            .push(Call::SendKey(surface.into(), key.into()));
        if self.ok && !self.keys_fail {
            Ok(())
        } else {
            Err(TransportFailure::new(self.error.clone()))
        }
    }
}

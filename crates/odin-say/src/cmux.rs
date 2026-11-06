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

pub trait Cmux {
    /// Raw pane text for `surface:<id>`; `Err` when the pane could not be read. A failed read
    /// is never an empty pane: the sender refuses instead of typing into a pane it cannot see.
    fn read_screen(&self, surface: &str) -> Result<String, ReadScreenFailed>;
    fn send_text(&self, surface: &str, text: &str) -> bool;
    fn send_key(&self, surface: &str, key: &str) -> bool;
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

    fn quiet(&self, args: &[&str]) -> bool {
        Command::new(&self.binary)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
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

    fn send_text(&self, surface: &str, text: &str) -> bool {
        self.quiet(&["send", "--surface", surface, text])
    }

    fn send_key(&self, surface: &str, key: &str) -> bool {
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

    fn send_text(&self, surface: &str, text: &str) -> bool {
        self.calls
            .borrow_mut()
            .push(Call::SendText(surface.into(), text.into()));
        self.ok
    }

    fn send_key(&self, surface: &str, key: &str) -> bool {
        self.calls
            .borrow_mut()
            .push(Call::SendKey(surface.into(), key.into()));
        self.ok
    }
}

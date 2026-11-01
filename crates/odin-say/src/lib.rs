//! odin-say: the ODIN CMUX delivery sender.
//!
//! Read the pane, classify it from [`rules::PaneRules`] data, refuse blocked panes at once,
//! WAIT on busy panes under a wall-clock budget (or send into a queue harness mid-turn when
//! that harness's rules say it buffers), send one flattened line, press Enter, verify by
//! reading the pane back, and append a proof record. Exit 0 only for DELIVERED_*.
//!
//! Layering: [`cmux`] is the only door to the pane multiplexer binary, [`clock`] is the only
//! door to time, [`rules`] is the only door to pane vocabulary, and [`proof`] is the only
//! door to the proof log.

pub mod clock;
pub mod cmux;
pub mod config;
pub mod identity;
pub mod proof;
pub mod rules;
pub mod say;
pub mod timeutil;

pub use clock::{Clock, FakeClock, RealClock};
pub use cmux::{Call, Cmux, RealCmux, StubCmux};
pub use config::{Config, ConfigFlags};
pub use identity::{identify, HarnessIdentity, HarnessSelector, HarnessSource};
pub use proof::{ProofEntry, RECORD_KIND_DELIVERY, RECORD_KIND_SEND_REFUSAL};
pub use rules::{HarnessRules, MidTurn, PaneRules};
pub use say::{
    classify, deliver, shows_queued, surface_locator, tail14, DeliveryOptions, DeliveryState,
    Outcome, PaneState,
};

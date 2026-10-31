//! Time seam for the bounded wait. Every wait decision uses a MONOTONIC clock
//! ([`std::time::Instant`] in production); tests drive [`FakeClock`] instead of sleeping, so
//! the wait budget is exercised without real time passing.
//!
//! `ODIN_SAY_TIME_SCALE` multiplies every real sleep (end-to-end tests set it to 0), the
//! same seam the field sender used.

use std::cell::{Cell, RefCell};
use std::time::{Duration, Instant};

pub trait Clock {
    /// Milliseconds since this clock was created, monotonically.
    fn elapsed_ms(&self) -> u64;
    /// Sleep on this clock. A fake clock advances its own elapsed time instead.
    fn sleep(&self, duration: Duration);
}

/// Wall-clock time, scaled by `ODIN_SAY_TIME_SCALE` (default 1.0).
pub struct RealClock {
    start: Instant,
    time_scale: f64,
}

impl RealClock {
    pub fn from_env() -> Self {
        Self::with_scale(
            std::env::var("ODIN_SAY_TIME_SCALE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1.0),
        )
    }

    pub fn with_scale(time_scale: f64) -> Self {
        Self {
            start: Instant::now(),
            time_scale,
        }
    }
}

impl Clock for RealClock {
    fn elapsed_ms(&self) -> u64 {
        u64::try_from(self.start.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    fn sleep(&self, duration: Duration) {
        let scaled = duration.mul_f64(self.time_scale.max(0.0));
        if !scaled.is_zero() {
            std::thread::sleep(scaled);
        }
    }
}

/// Test double: time only moves when [`Clock::sleep`] is called, so a wait budget is
/// exercised deterministically. Every requested sleep is recorded for assertions.
#[derive(Debug, Default)]
pub struct FakeClock {
    elapsed_ms: Cell<u64>,
    sleeps_ms: RefCell<Vec<u64>>,
}

impl FakeClock {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sleeps_ms(&self) -> Vec<u64> {
        self.sleeps_ms.borrow().clone()
    }
}

impl Clock for FakeClock {
    fn elapsed_ms(&self) -> u64 {
        self.elapsed_ms.get()
    }

    fn sleep(&self, duration: Duration) {
        let ms = u64::try_from(duration.as_millis()).unwrap_or(u64::MAX);
        self.sleeps_ms.borrow_mut().push(ms);
        self.elapsed_ms
            .set(self.elapsed_ms.get().saturating_add(ms));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_clock_only_moves_when_it_sleeps() {
        let clock = FakeClock::new();
        assert_eq!(clock.elapsed_ms(), 0);
        clock.sleep(Duration::from_millis(1500));
        assert_eq!(clock.elapsed_ms(), 1500);
        clock.sleep(Duration::from_secs(5));
        assert_eq!(clock.elapsed_ms(), 6500);
        assert_eq!(clock.sleeps_ms(), vec![1500, 5000]);
    }
}

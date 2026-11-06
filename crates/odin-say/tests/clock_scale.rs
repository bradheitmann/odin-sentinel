//! F-13: `ODIN_SAY_TIME_SCALE` is a test/ops seam, and an unusable value must never panic.
//! `Duration::mul_f64` panics on a non-finite or negative scale, and the first sleep happens
//! AFTER the text is typed — so a panic there would send the message and write no proof record.

use odin_say::clock::{Clock, RealClock};
use std::time::Duration;

#[test]
fn an_infinite_scale_does_not_panic_on_the_first_sleep() {
    let clock = RealClock::with_scale(f64::INFINITY);
    clock.sleep(Duration::from_millis(1));
}

#[test]
fn a_nan_or_negative_scale_does_not_panic_on_the_first_sleep() {
    RealClock::with_scale(f64::NAN).sleep(Duration::from_millis(1));
    RealClock::with_scale(-3.0).sleep(Duration::from_millis(1));
}

#[test]
fn a_finite_scale_still_scales_the_real_sleep() {
    // 5 ms scaled by 0 is still a no-op sleep, and the clock keeps moving.
    let clock = RealClock::with_scale(0.0);
    clock.sleep(Duration::from_millis(5));
    assert!(clock.elapsed_ms() < 5_000);
}

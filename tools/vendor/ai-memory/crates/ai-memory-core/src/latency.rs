//! Fixed-bucket latency histogram for the `/admin/metrics` endpoint.
//!
//! One observation is a bounded scan over a fixed bucket table plus three
//! relaxed atomic adds: no lock, no allocation, nothing keyed on request data.
//! The histogram holds counts only, so it cannot carry a query, a prompt or a
//! scope name, and its memory never grows.

use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Upper bounds of the finite buckets, in microseconds (Prometheus `le`,
/// inclusive). The last bucket, `+Inf`, is implicit. The range covers a
/// sub-millisecond hook admission up to a slow reranked query.
pub const LATENCY_BUCKET_BOUNDS_US: [u64; 13] = [
    1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000,
    5_000_000, 10_000_000,
];

const BUCKETS: usize = LATENCY_BUCKET_BOUNDS_US.len() + 1;

/// Process-lifetime latency histogram with fixed buckets.
///
/// Relaxed ordering, as in [`crate::IngestMetrics`]: a scrape that sees a
/// bucket a few observations stale is fine; a fence on the hot path is not.
#[derive(Debug, Default)]
pub struct LatencyHistogram {
    /// Per-bucket counts, not cumulative. Rendering accumulates them.
    buckets: [AtomicU64; BUCKETS],
    /// Total observed time, in microseconds.
    sum_us: AtomicU64,
}

impl LatencyHistogram {
    /// Record one observation.
    pub fn observe(&self, elapsed: Duration) {
        let us = u64::try_from(elapsed.as_micros()).unwrap_or(u64::MAX);
        let idx = LATENCY_BUCKET_BOUNDS_US
            .iter()
            .position(|bound| us <= *bound)
            .unwrap_or(BUCKETS - 1);
        self.buckets[idx].fetch_add(1, Ordering::Relaxed);
        self.sum_us.fetch_add(us, Ordering::Relaxed);
    }

    /// Start a timer that records into this histogram when dropped, so every
    /// return path of the measured call is counted, errors included.
    #[must_use]
    pub fn start(&self) -> LatencyTimer<'_> {
        LatencyTimer {
            histogram: self,
            started: Instant::now(),
        }
    }

    /// Read the histogram: per-bucket counts (non-cumulative, `+Inf` last)
    /// and the total observed microseconds.
    #[must_use]
    pub fn snapshot(&self) -> LatencySnapshot {
        let mut buckets = [0_u64; BUCKETS];
        for (slot, bucket) in buckets.iter_mut().zip(&self.buckets) {
            *slot = bucket.load(Ordering::Relaxed);
        }
        LatencySnapshot {
            buckets,
            sum_us: self.sum_us.load(Ordering::Relaxed),
        }
    }
}

/// Records the time since [`LatencyHistogram::start`] when dropped.
#[derive(Debug)]
pub struct LatencyTimer<'a> {
    histogram: &'a LatencyHistogram,
    started: Instant,
}

impl Drop for LatencyTimer<'_> {
    fn drop(&mut self) {
        self.histogram.observe(self.started.elapsed());
    }
}

/// A read of a [`LatencyHistogram`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LatencySnapshot {
    /// Per-bucket counts in [`LATENCY_BUCKET_BOUNDS_US`] order, `+Inf` last.
    pub buckets: [u64; BUCKETS],
    /// Total observed microseconds.
    pub sum_us: u64,
}

impl LatencySnapshot {
    /// Number of observations.
    #[must_use]
    pub fn count(&self) -> u64 {
        self.buckets.iter().copied().fold(0, u64::saturating_add)
    }

    /// Append this histogram in the Prometheus text exposition format, in
    /// seconds. `name` and `help` are compile-time constants chosen by the
    /// caller, never request data. `_count` is derived from the buckets so
    /// the cumulative series always ends at `_count`, even if a scrape races
    /// an observation.
    pub fn write_prometheus(&self, out: &mut String, name: &str, help: &str) {
        let _ = writeln!(out, "# HELP {name} {help}");
        let _ = writeln!(out, "# TYPE {name} histogram");
        let mut cumulative = 0_u64;
        for (bound, count) in LATENCY_BUCKET_BOUNDS_US.iter().zip(&self.buckets) {
            cumulative = cumulative.saturating_add(*count);
            let le = seconds(*bound);
            let _ = writeln!(out, "{name}_bucket{{le=\"{le}\"}} {cumulative}");
        }
        let total = self.count();
        let _ = writeln!(out, "{name}_bucket{{le=\"+Inf\"}} {total}");
        let _ = writeln!(out, "{name}_sum {}", seconds(self.sum_us));
        let _ = writeln!(out, "{name}_count {total}");
    }
}

/// Microseconds as a Prometheus float of seconds.
#[allow(clippy::cast_precision_loss)]
fn seconds(us: u64) -> f64 {
    us as f64 / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observations_land_in_the_inclusive_bucket() {
        let h = LatencyHistogram::default();
        h.observe(Duration::from_micros(1_000));
        h.observe(Duration::from_micros(1_001));
        h.observe(Duration::from_secs(60));
        let s = h.snapshot();
        assert_eq!(s.buckets[0], 1, "le=0.001 is inclusive");
        assert_eq!(s.buckets[1], 1);
        assert_eq!(s.buckets[BUCKETS - 1], 1, "past the last bound is +Inf");
        assert_eq!(s.count(), 3);
        assert_eq!(s.sum_us, 1_000 + 1_001 + 60_000_000);
    }

    #[test]
    fn a_timer_records_once_when_dropped() {
        let h = LatencyHistogram::default();
        {
            let _timer = h.start();
        }
        assert_eq!(h.snapshot().count(), 1);
    }

    #[test]
    fn prometheus_buckets_are_cumulative_and_end_at_the_count() {
        let h = LatencyHistogram::default();
        h.observe(Duration::from_micros(500));
        h.observe(Duration::from_millis(30));
        h.observe(Duration::from_secs(30));
        let mut out = String::new();
        h.snapshot()
            .write_prometheus(&mut out, "x_seconds", "Test histogram.");
        assert!(out.starts_with("# HELP x_seconds Test histogram.\n# TYPE x_seconds histogram\n"));
        assert!(out.contains("x_seconds_bucket{le=\"0.001\"} 1\n"), "{out}");
        assert!(out.contains("x_seconds_bucket{le=\"0.025\"} 1\n"), "{out}");
        assert!(out.contains("x_seconds_bucket{le=\"0.05\"} 2\n"), "{out}");
        assert!(out.contains("x_seconds_bucket{le=\"10\"} 2\n"), "{out}");
        assert!(out.contains("x_seconds_bucket{le=\"+Inf\"} 3\n"), "{out}");
        assert!(out.contains("x_seconds_count 3\n"), "{out}");
        assert!(out.contains("x_seconds_sum 30.0305\n"), "{out}");
    }

    #[test]
    fn concurrent_observations_are_not_lost() {
        use std::sync::Arc;
        let h = Arc::new(LatencyHistogram::default());
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let h = Arc::clone(&h);
                std::thread::spawn(move || {
                    for _ in 0..1000 {
                        h.observe(Duration::from_micros(7));
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("thread");
        }
        assert_eq!(h.snapshot().count(), 8000);
    }
}

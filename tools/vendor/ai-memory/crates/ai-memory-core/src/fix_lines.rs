//! Operator fix commands shared by `ai-memory status` and the web health
//! page, so both print the same line for the same condition.

/// Returns reclaimable SQLite pages to the filesystem.
pub const COMPACT: &str = "ai-memory compact --confirm";

/// Delivers spooled hook events and replays the recovery journal.
pub const RECOVER: &str = "ai-memory recover";

/// Embeds latest pages that have no vector yet.
pub const EMBED: &str = "ai-memory embed";

/// Re-embeds pages whose stored vectors were made under another
/// `{provider, model, dim}`.
pub const EMBED_FORCE: &str = "ai-memory embed --force";

/// Suggest compaction only above this share of the file. Below it the
/// exclusive lock costs more than the space is worth, and SQLite will reuse
/// those pages on its own as the store grows.
pub const RECLAIM_ADVICE_PCT: f64 = 20.0;

/// …and only when the absolute figure is worth a stall. 20% of a 4 MiB
/// database is not a reason to block every write.
pub const RECLAIM_ADVICE_MIN_BYTES: u64 = 64 * 1024 * 1024;

/// Whether `reclaimable_bytes` of a `database_bytes` file is worth
/// suggesting [`COMPACT`] for.
#[must_use]
pub fn reclaim_advised(reclaimable_bytes: u64, database_bytes: u64) -> bool {
    if database_bytes == 0 {
        return false;
    }
    let pct = (reclaimable_bytes as f64 / database_bytes as f64) * 100.0;
    pct >= RECLAIM_ADVICE_PCT && reclaimable_bytes >= RECLAIM_ADVICE_MIN_BYTES
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reclaim_needs_both_the_share_and_the_size() {
        let gib = 1024 * 1024 * 1024;
        assert!(reclaim_advised(gib / 4, gib), "25% of 1 GiB");
        assert!(!reclaim_advised(gib / 10, gib), "10% is below the share");
        assert!(
            !reclaim_advised(2 * 1024 * 1024, 4 * 1024 * 1024),
            "50% of 4 MiB is below the size floor"
        );
        assert!(!reclaim_advised(0, 0), "an empty file never advises");
    }
}

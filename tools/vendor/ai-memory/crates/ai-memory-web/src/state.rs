//! Web router state — the handle a request handler receives.
//!
//! Holds the read-only store pool + the wiki handle. Cheap to clone
//! (everything inside is `Arc`-shaped already), so axum's
//! `State<Arc<WebState>>` extractor stays free of clone-heavy code.

use std::sync::Arc;

use ai_memory_store::ReaderPool;
use ai_memory_wiki::Wiki;

use crate::health::HealthSources;
use crate::recall::Recall;

/// Shared state for every web route. Construct once via
/// [`crate::router`].
#[derive(Clone)]
pub struct WebState {
    /// Read-only SQLite pool — drives FTS5 search, page metadata,
    /// project list aggregates.
    pub reader: ReaderPool,
    /// Wiki handle — reads page bodies from disk.
    pub wiki: Wiki,
    /// A trusted identity proxy asserts usernames, so the deployment tells
    /// operators apart even with no `users` rows. Root-only pages pass it to
    /// `ReaderPool::distinguishes_operators`, as the `/admin` gate does.
    pub trusted_proxy_identity: bool,
    /// The configured embedder and reranker, so project search runs the same
    /// hybrid ranker as `memory_query`. Empty on a zero-LLM server.
    pub recall: Recall,
    /// Process-side sources for the root-only health page. `None` when the
    /// host did not wire them (the page then says so).
    pub health: Option<Arc<HealthSources>>,
}

impl WebState {
    /// Build a new shared state.
    #[must_use]
    pub fn new(reader: ReaderPool, wiki: Wiki) -> Self {
        Self {
            reader,
            wiki,
            trusted_proxy_identity: false,
            recall: Recall::default(),
            health: None,
        }
    }

    /// Record whether a trusted identity proxy is configured.
    #[must_use]
    pub fn with_trusted_proxy_identity(mut self, trusted_proxy_identity: bool) -> Self {
        self.trusted_proxy_identity = trusted_proxy_identity;
        self
    }

    /// Use the server's configured embedder and reranker for search.
    #[must_use]
    pub fn with_recall(mut self, recall: Recall) -> Self {
        self.recall = recall;
        self
    }

    /// Attach the process-side sources the health page reads.
    #[must_use]
    pub fn with_health(mut self, health: Arc<HealthSources>) -> Self {
        self.health = Some(health);
        self
    }
}

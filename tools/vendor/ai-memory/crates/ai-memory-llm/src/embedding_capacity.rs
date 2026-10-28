//! Capacity isolation for in-process embedding inference.
//!
//! Local model inference is CPU-heavy and already parallelizes internally.
//! Letting background page writes fill every inference slot can more than
//! double interactive query latency. [`EmbeddingCapacity`] bounds total work
//! while reserving one slot for query embeddings; a query that finds every
//! slot busy waits a bounded interval ([`QUERY_CAPACITY_WAIT`]) before
//! degrading, so a transient race with a document embed does not silently
//! drop the vector stream from a search.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::{Embedder, LlmError, LlmResult};

/// How long an interactive query waits for an inference slot before the
/// search degrades to lexical + entity + graph retrieval.
///
/// Long enough to ride out a finishing document embed (or a sibling query)
/// under write load; short enough that `memory_query` latency stays
/// interactive even when background indexing saturates every slot for a
/// sustained period.
const QUERY_CAPACITY_WAIT: Duration = Duration::from_millis(250);

/// Derive the local embedder's total capacity from CPU parallelism.
///
/// `cores` is what the caller observed via `available_parallelism()`
/// (callers pass a small fallback such as 4 when that syscall fails; 0 or
/// tiny values clamp to the minimum). Why halve and clamp:
///
/// - all-MiniLM inference (candle) already parallelizes across cores
///   *inside* one embed, so `capacity` bounds concurrent calls, each of
///   which wants several threads. Half the available slots recovers most
///   of the ingest throughput a single background document slot lost
///   (#1580) while mild oversubscription keeps the CPU busy.
/// - clamping to at least 2 preserves the reserved query slot
///   ([`EmbeddingCapacity::new`] refuses less); clamping to 6 stops a
///   many-core host from running so many CPU-bound embeds at once that
///   interactive latency climbs right back up.
pub fn local_capacity(cores: usize) -> usize {
    (cores / 2).clamp(2, 6)
}

/// Embedder wrapper that bounds inference and reserves foreground capacity.
///
/// `capacity` must be at least two. Document and generic embeddings may use
/// at most `capacity - 1` slots, so an interactive query can enter without
/// waiting for background indexing work to finish. A query that does find
/// every slot busy waits up to [`QUERY_CAPACITY_WAIT`] before failing, at
/// which point search degrades to lexical + entity + graph retrieval rather
/// than queueing unboundedly.
pub struct EmbeddingCapacity {
    inner: Arc<dyn Embedder>,
    total: Arc<Semaphore>,
    documents: Arc<Semaphore>,
}

impl EmbeddingCapacity {
    /// Wrap `inner` with a bounded scheduler.
    ///
    /// # Errors
    /// Returns [`LlmError::NotConfigured`] when fewer than two slots are
    /// requested because that cannot reserve foreground capacity.
    pub fn new(inner: Arc<dyn Embedder>, capacity: usize) -> LlmResult<Self> {
        if capacity < 2 {
            return Err(LlmError::NotConfigured(
                "embedding capacity must be at least 2".into(),
            ));
        }
        Ok(Self {
            inner,
            total: Arc::new(Semaphore::new(capacity)),
            documents: Arc::new(Semaphore::new(capacity - 1)),
        })
    }

    async fn acquire_document_capacity(
        &self,
    ) -> LlmResult<(OwnedSemaphorePermit, OwnedSemaphorePermit)> {
        let document = self
            .documents
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| capacity_closed())?;
        let total = self
            .total
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| capacity_closed())?;
        Ok((document, total))
    }

    async fn finish_task(
        task: tokio::task::JoinHandle<LlmResult<Vec<f32>>>,
    ) -> LlmResult<Vec<f32>> {
        task.await
            .map_err(|e| LlmError::UnexpectedShape(format!("embedding task: {e}")))?
    }
}

fn capacity_closed() -> LlmError {
    LlmError::UnexpectedShape("embedding capacity scheduler closed".into())
}

#[async_trait]
impl Embedder for EmbeddingCapacity {
    fn provider(&self) -> &'static str {
        self.inner.provider()
    }

    fn model(&self) -> &str {
        self.inner.model()
    }

    fn model_identity(&self) -> String {
        self.inner.model_identity()
    }

    fn dim(&self) -> u32 {
        self.inner.dim()
    }

    async fn embed(&self, text: &str) -> LlmResult<Vec<f32>> {
        let capacity = self.acquire_document_capacity().await?;
        let inner = Arc::clone(&self.inner);
        let text = text.to_owned();
        Self::finish_task(tokio::spawn(async move {
            let _capacity = capacity;
            inner.embed(&text).await
        }))
        .await
    }

    async fn embed_document(&self, text: &str) -> LlmResult<Vec<f32>> {
        let capacity = self.acquire_document_capacity().await?;
        let inner = Arc::clone(&self.inner);
        let text = text.to_owned();
        Self::finish_task(tokio::spawn(async move {
            let _capacity = capacity;
            inner.embed_document(&text).await
        }))
        .await
    }

    async fn embed_query(&self, text: &str) -> LlmResult<Vec<f32>> {
        // Bounded wait, not try_acquire: an instant refusal made a query
        // that merely raced a document embed silently degrade the whole
        // search to FTS-only (#1580), dropping the vector stream for that
        // query. Waiting up to QUERY_CAPACITY_WAIT absorbs transient
        // saturation; only a slot busy for the whole window degrades.
        let capacity =
            tokio::time::timeout(QUERY_CAPACITY_WAIT, self.total.clone().acquire_owned())
                .await
                .map_err(|_| LlmError::CapacityBusy("embedding"))?
                .map_err(|_| capacity_closed())?;
        let inner = Arc::clone(&self.inner);
        let text = text.to_owned();
        Self::finish_task(tokio::spawn(async move {
            let _capacity = capacity;
            inner.embed_query(&text).await
        }))
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::sync::mpsc;

    use super::*;

    struct BlockingEmbedder {
        entered: mpsc::UnboundedSender<&'static str>,
        releases: Arc<Semaphore>,
    }

    impl BlockingEmbedder {
        /// Wrap a blocking embedder at `capacity`, returning the staged
        /// embedder, the release latch, and the stream of entered
        /// operations.
        fn stage(
            capacity: usize,
        ) -> (
            Arc<dyn Embedder>,
            Arc<Semaphore>,
            mpsc::UnboundedReceiver<&'static str>,
        ) {
            let (entered, entered_rx) = mpsc::unbounded_channel();
            let releases = Arc::new(Semaphore::new(0));
            let stage: Arc<dyn Embedder> = Arc::new(
                EmbeddingCapacity::new(
                    Arc::new(BlockingEmbedder {
                        entered,
                        releases: Arc::clone(&releases),
                    }),
                    capacity,
                )
                .unwrap(),
            );
            (stage, releases, entered_rx)
        }

        async fn block(&self, operation: &'static str) -> LlmResult<Vec<f32>> {
            self.entered.send(operation).unwrap();
            self.releases
                .acquire()
                .await
                .map_err(|_| capacity_closed())?
                .forget();
            Ok(vec![1.0])
        }
    }

    #[async_trait]
    impl Embedder for BlockingEmbedder {
        fn provider(&self) -> &'static str {
            "blocking"
        }

        fn model(&self) -> &str {
            "test"
        }

        fn model_identity(&self) -> String {
            "document-identity".into()
        }

        fn dim(&self) -> u32 {
            1
        }

        async fn embed(&self, _text: &str) -> LlmResult<Vec<f32>> {
            self.block("generic").await
        }

        async fn embed_document(&self, _text: &str) -> LlmResult<Vec<f32>> {
            self.block("document").await
        }

        async fn embed_query(&self, _text: &str) -> LlmResult<Vec<f32>> {
            self.block("query").await
        }
    }

    #[test]
    fn requires_a_foreground_reservation() {
        let (entered, _entered_rx) = mpsc::unbounded_channel();
        let inner = Arc::new(BlockingEmbedder {
            entered,
            releases: Arc::new(Semaphore::new(0)),
        });
        assert!(EmbeddingCapacity::new(inner, 1).is_err());
    }

    #[tokio::test]
    async fn query_enters_while_second_document_waits() {
        let (entered, mut entered_rx) = mpsc::unbounded_channel();
        let releases = Arc::new(Semaphore::new(0));
        let inner = Arc::new(BlockingEmbedder {
            entered,
            releases: Arc::clone(&releases),
        });
        let stage: Arc<dyn Embedder> = Arc::new(EmbeddingCapacity::new(inner, 2).unwrap());

        let first_document = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_document("one").await })
        };
        assert_eq!(entered_rx.recv().await, Some("document"));

        let second_document = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_document("two").await })
        };
        let query = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_query("find it").await })
        };

        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
                .await
                .unwrap(),
            Some("query"),
            "the reserved query slot must remain available"
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(25), entered_rx.recv())
                .await
                .is_err(),
            "the second document must wait for the document slot"
        );

        releases.add_permits(1);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
                .await
                .unwrap(),
            Some("document")
        );
        releases.add_permits(2);
        first_document.await.unwrap().unwrap();
        second_document.await.unwrap().unwrap();
        query.await.unwrap().unwrap();
    }

    /// The #1580 regression shape: a query that arrives while every slot is
    /// momentarily held must WAIT for the next free slot and succeed, not
    /// degrade the search to FTS-only on an instant refusal.
    #[tokio::test]
    async fn query_waits_out_transient_saturation_instead_of_degrading() {
        let (stage, releases, mut entered_rx) = BlockingEmbedder::stage(2);

        // Saturate both total slots: one document embed plus one query,
        // both blocked inside the embedder.
        let document = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_document("one").await })
        };
        assert_eq!(entered_rx.recv().await, Some("document"));
        let first_query = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_query("first").await })
        };
        assert_eq!(entered_rx.recv().await, Some("query"));

        // A second query cannot start while both slots are held...
        let second_query = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_query("second").await })
        };
        assert!(
            tokio::time::timeout(Duration::from_millis(25), entered_rx.recv())
                .await
                .is_err(),
            "the second query must wait for a slot, not start immediately"
        );

        // ...but the moment one holder finishes — well inside the bounded
        // wait — it proceeds and returns a vector. No CapacityBusy, no
        // degraded search.
        releases.add_permits(1);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
                .await
                .unwrap(),
            Some("query"),
            "the waiting query must take the slot freed for it"
        );
        releases.add_permits(2);
        assert_eq!(second_query.await.unwrap().unwrap(), vec![1.0]);
        document.await.unwrap().unwrap();
        first_query.await.unwrap().unwrap();
    }

    /// Under *sustained* saturation the query still degrades — but only
    /// after the bounded wait elapses, never before. Paused time makes the
    /// 250 ms window advance deterministically instead of sleeping.
    #[tokio::test(start_paused = true)]
    async fn saturated_query_degrades_only_after_the_bounded_wait() {
        let (stage, releases, mut entered_rx) = BlockingEmbedder::stage(2);

        let document = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_document("one").await })
        };
        assert_eq!(entered_rx.recv().await, Some("document"));
        let first_query = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_query("first").await })
        };
        assert_eq!(entered_rx.recv().await, Some("query"));

        // Both total slots stay held for the whole window: the wait must
        // elapse before the refusal, and `embed_search_query` surfaces it
        // as FTS-only degradation (None) rather than an error.
        let started = tokio::time::Instant::now();
        assert!(matches!(
            stage.embed_query("saturated").await,
            Err(LlmError::CapacityBusy(_))
        ));
        assert!(
            started.elapsed() >= QUERY_CAPACITY_WAIT,
            "degradation must follow the bounded wait, not race it (took {:?})",
            started.elapsed()
        );
        assert!(
            crate::embed_search_query(stage.as_ref(), "also saturated")
                .await
                .is_none()
        );

        // Control: the saturating holders are still inside the embedder —
        // the refusal came from the wait elapsing, not from them finishing.
        releases.add_permits(2);
        document.await.unwrap().unwrap();
        first_query.await.unwrap().unwrap();
    }

    /// Documents themselves stay bounded: at most `capacity - 1` run
    /// concurrently, and the slot that frees is still query-shaped.
    #[tokio::test]
    async fn documents_run_at_capacity_minus_one_concurrently() {
        let (stage, releases, mut entered_rx) = BlockingEmbedder::stage(4);

        let mut documents = Vec::new();
        for text in ["one", "two", "three", "four"] {
            let stage = Arc::clone(&stage);
            documents.push(tokio::spawn(
                async move { stage.embed_document(text).await },
            ));
        }
        for _ in 0..3 {
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
                    .await
                    .unwrap(),
                Some("document"),
                "three of four documents should embed concurrently"
            );
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(25), entered_rx.recv())
                .await
                .is_err(),
            "the fourth document must wait: only capacity-1 document slots exist"
        );

        // The reserved total slot still admits a query alongside three
        // running documents.
        let query = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_query("find it").await })
        };
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
                .await
                .unwrap(),
            Some("query")
        );

        releases.add_permits(3);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
                .await
                .unwrap(),
            Some("document"),
            "the fourth document must take the freed document slot"
        );
        releases.add_permits(2);
        for document in documents {
            document.await.unwrap().unwrap();
        }
        query.await.unwrap().unwrap();
    }

    /// The serve.rs sizing table (#1580): half the cores, clamped so the
    /// query reservation survives tiny hosts and many-core hosts alike.
    #[test]
    fn local_capacity_scales_with_cores_and_stays_bounded() {
        assert_eq!(local_capacity(0), 2, "no/failed parallelism clamps up");
        assert_eq!(local_capacity(1), 2);
        assert_eq!(local_capacity(4), 2);
        assert_eq!(local_capacity(8), 4);
        assert_eq!(local_capacity(16), 6);
        assert_eq!(local_capacity(32), 6, "many-core hosts cap at six slots");
        assert_eq!(local_capacity(256), 6);
    }

    #[tokio::test]
    async fn cancelled_caller_does_not_release_capacity_before_inference_finishes() {
        let (entered, mut entered_rx) = mpsc::unbounded_channel();
        let releases = Arc::new(Semaphore::new(0));
        let stage: Arc<dyn Embedder> = Arc::new(
            EmbeddingCapacity::new(
                Arc::new(BlockingEmbedder {
                    entered,
                    releases: Arc::clone(&releases),
                }),
                2,
            )
            .unwrap(),
        );

        let cancelled = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_document("cancel me").await })
        };
        assert_eq!(entered_rx.recv().await, Some("document"));
        cancelled.abort();
        assert!(cancelled.await.unwrap_err().is_cancelled());

        let next = {
            let stage = Arc::clone(&stage);
            tokio::spawn(async move { stage.embed_document("wait for capacity").await })
        };
        assert!(
            tokio::time::timeout(Duration::from_millis(25), entered_rx.recv())
                .await
                .is_err(),
            "cancelled caller must not free a still-running inference slot"
        );

        releases.add_permits(1);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), entered_rx.recv())
                .await
                .unwrap(),
            Some("document")
        );
        releases.add_permits(1);
        next.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn generic_embedding_keeps_inner_method_semantics() {
        let (entered, mut entered_rx) = mpsc::unbounded_channel();
        let releases = Arc::new(Semaphore::new(0));
        let stage = Arc::new(
            EmbeddingCapacity::new(
                Arc::new(BlockingEmbedder {
                    entered,
                    releases: Arc::clone(&releases),
                }),
                2,
            )
            .unwrap(),
        );
        let task = tokio::spawn(async move { stage.embed("generic input").await });
        assert_eq!(entered_rx.recv().await, Some("generic"));
        releases.add_permits(1);
        task.await.unwrap().unwrap();
    }

    #[test]
    fn delegates_embedding_identity() {
        let (entered, _entered_rx) = mpsc::unbounded_channel();
        let stage = EmbeddingCapacity::new(
            Arc::new(BlockingEmbedder {
                entered,
                releases: Arc::new(Semaphore::new(0)),
            }),
            2,
        )
        .unwrap();
        assert_eq!(stage.provider(), "blocking");
        assert_eq!(stage.model(), "test");
        assert_eq!(stage.model_identity(), "document-identity");
        assert_eq!(stage.dim(), 1);
    }
}

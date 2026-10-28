//! `GET /health` — root-only server health panel.
//!
//! Reads hook counters, the writer queue, the local spool and recovery
//! journal, the consolidation queue, embedder and provider state, and runs
//! the server-side checks in [`crate::health::checks`] with their fix lines.
//! It only reads: there is no button on the page and no write path behind
//! it. Root-only on a multi-user server through the same `Capability::Admin`
//! gate as `/pending` and every `/admin/*` route, because the counters
//! describe the whole server, not one repository.

use std::sync::Arc;

use ai_memory_core::{AuthLevel, IngestMetrics};
use ai_memory_llm::{ProviderHealthSnapshot, ProviderRoleHealthSnapshot};
use askama::Template;
use axum::Extension;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};

use crate::health::{EmbedderIdentity, HealthSnapshot, ProcessState, checks};
use crate::state::WebState;
use crate::templates::{HealthCheckRow, HealthRow, HealthSection, HealthView};

/// Handler for `GET /health`.
pub(crate) async fn handler(
    State(state): State<Arc<WebState>>,
    level: Option<Extension<AuthLevel>>,
) -> Response {
    if let Err(response) = super::require_admin(&state, level).await {
        return response;
    }
    let internal = |error: ai_memory_store::StoreError| {
        tracing::error!(%error, "web health read failed");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    };
    // The configured embedder's stored-vector triple, read once so the
    // missing-vector count and the "embedder" row below both match the
    // identity rows are stored under (`model_identity`, not the wire
    // model name). With no embedder the historical "no vector at all"
    // count is kept. The count takes a clone: the row keeps the original.
    let configured_embedding = state.recall.embedder.as_deref().map(|embedder| {
        (
            embedder.provider().to_owned(),
            embedder.model_identity(),
            embedder.dim(),
        )
    });
    let derived = match match configured_embedding.clone() {
        Some(identity) => {
            state
                .reader
                .derived_index_status_for_embedding(identity)
                .await
        }
        None => state.reader.derived_index_status().await,
    } {
        Ok(derived) => derived,
        Err(error) => return internal(error),
    };
    // Pragma reads; a failure must not take the whole page down.
    let storage = state.reader.storage_status().await.unwrap_or_default();
    let consolidation = match state.reader.session_consolidation_queue().await {
        Ok(queue) => queue,
        Err(error) => return internal(error),
    };
    let (ingest, providers, process) = match &state.health {
        Some(sources) => {
            // The spool and journal reads touch the filesystem; keep them off
            // the async workers.
            let probe = Arc::clone(&sources.probe);
            let process = tokio::task::spawn_blocking(move || probe.process_state())
                .await
                .unwrap_or_default();
            (
                sources.ingest.snapshot(),
                sources.providers.snapshot(),
                process,
            )
        }
        None => (
            IngestMetrics::default().snapshot(),
            ProviderHealthSnapshot::default(),
            ProcessState::default(),
        ),
    };
    let snapshot = HealthSnapshot {
        ingest,
        providers,
        process,
        derived,
        storage,
        consolidation,
        embedder: configured_embedding.map(|(provider, model, dim)| EmbedderIdentity {
            provider,
            model,
            dim,
        }),
    };
    let view = HealthView {
        wired: state.health.is_some(),
        checks: checks(&snapshot)
            .into_iter()
            .map(|check| HealthCheckRow {
                id: check.id,
                status: check.status.label(),
                detail: check.detail,
                fix: check.fix,
            })
            .collect(),
        sections: sections(&snapshot, state.recall.rerank.is_some()),
    };
    match view.render() {
        Ok(body) => {
            let mut response = Html(body).into_response();
            // Server-wide operator state: never cache it in a shared proxy.
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, no-store"),
            );
            response
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn row(label: &'static str, value: impl Into<String>) -> HealthRow {
    HealthRow {
        label,
        value: value.into(),
    }
}

fn micros(us: Option<i64>) -> String {
    us.and_then(|us| jiff::Timestamp::from_microsecond(us).ok())
        .map_or_else(|| "never".to_owned(), |ts| ts.to_string())
}

fn age(ms: Option<u64>) -> String {
    let Some(ms) = ms else {
        return "n/a".to_owned();
    };
    let secs = ms / 1000;
    match secs {
        0..60 => format!("{secs}s"),
        60..3600 => format!("{}m", secs / 60),
        3600..86_400 => format!("{}h", secs / 3600),
        _ => format!("{}d", secs / 86_400),
    }
}

/// `status provider/model[ dim N] · last ok … · last error … (HTTP n)`.
/// The provider's error message is left out: it can quote a response body.
fn provider_line(role: &ProviderRoleHealthSnapshot) -> String {
    let mut out = role.status.as_str().to_owned();
    if let Some(provider) = &role.provider {
        out.push_str(&format!(
            " · {provider}/{}",
            role.model.as_deref().unwrap_or("?")
        ));
    }
    if let Some(dim) = role.dim {
        out.push_str(&format!(" (dim {dim})"));
    }
    if let Some(at) = role.last_success_at {
        out.push_str(&format!(" · last ok {at}"));
    }
    if let Some(at) = role.last_error_at {
        out.push_str(&format!(" · last error {at}"));
        if let Some(status) = role.last_error_status {
            out.push_str(&format!(" (HTTP {status})"));
        }
    }
    out
}

fn sections(s: &HealthSnapshot, rerank: bool) -> Vec<HealthSection> {
    let ingest = &s.ingest;
    let hooks = HealthSection {
        title: "Hooks (since the server started)",
        rows: vec![
            row("accepted", ingest.accepted.to_string()),
            row(
                "shed (429)",
                format!(
                    "{} ({} saturated, {} rate-limited)",
                    ingest.shed_saturated + ingest.shed_rate_limited,
                    ingest.shed_saturated,
                    ingest.shed_rate_limited
                ),
            ),
            row(
                "outcomes",
                format!(
                    "{} stored, {} replayed, {} resumed, {} ignored end, {} failed",
                    ingest.stored,
                    ingest.replayed,
                    ingest.resumed,
                    ingest.ignored_end,
                    ingest.failed
                ),
            ),
            row(
                "dropped",
                format!(
                    "{} capture policy, {} unauthorized, {} collision, {} invalid",
                    ingest.dropped_by_policy,
                    ingest.dropped_unauthorized,
                    ingest.dropped_collision,
                    ingest.dropped_invalid
                ),
            ),
            row(
                "last write",
                micros(
                    ingest
                        .last_persisted_ms
                        .and_then(|ms| i64::try_from(ms).ok())
                        .map(|ms| ms.saturating_mul(1000)),
                ),
            ),
        ],
    };
    let process = &s.process;
    let local = HealthSection {
        title: "Writer, spool and recovery",
        rows: vec![
            row(
                "write queue",
                process.write_queue.map_or_else(
                    || "unknown".to_owned(),
                    |(queued, capacity)| format!("{queued}/{capacity}"),
                ),
            ),
            row(
                "hook spool",
                process.spool.map_or_else(
                    || "not visible to this server".to_owned(),
                    |spool| {
                        format!(
                            "{} pending of {} (oldest {}, {} retries)",
                            spool.pending,
                            spool.capacity,
                            age(spool.oldest_age_ms),
                            spool.retries_total
                        )
                    },
                ),
            ),
            row(
                "recovery journal",
                process.journal.map_or_else(
                    || "not visible to this server".to_owned(),
                    |journal| {
                        if journal.unreadable {
                            "unreadable".to_owned()
                        } else {
                            format!(
                                "{} pending ({} degraded, {} finish-failed)",
                                journal.pending, journal.degraded, journal.finish_failed
                            )
                        }
                    },
                ),
            ),
        ],
    };
    let queue = &s.consolidation;
    let consolidation = HealthSection {
        title: "Consolidation",
        rows: vec![
            row("last completed", micros(queue.last_completed_at_us)),
            row(
                "queue",
                format!(
                    "{} pending, {} running, {} completed, {} failed",
                    queue.pending, queue.running, queue.completed, queue.failed
                ),
            ),
            row(
                "oldest pending since",
                micros(queue.oldest_pending_requested_at_us),
            ),
        ],
    };
    let mut models = vec![
        row(
            "embedder",
            s.embedder.as_ref().map_or_else(
                || "none (FTS5 + entity + graph only)".to_owned(),
                |e| format!("{}/{} (dim {})", e.provider, e.model, e.dim),
            ),
        ),
        row("embedding provider", provider_line(&s.providers.embedding)),
        row("llm provider", provider_line(&s.providers.llm)),
        row("reranker", if rerank { "on" } else { "off" }),
        row(
            "vectors",
            format!(
                "{} rows; {} latest pages missing; {} unembeddable",
                s.derived.embedding_rows,
                s.derived.latest_pages_missing_embeddings,
                s.derived.latest_pages_unembeddable
            ),
        ),
    ];
    for triple in &s.derived.embedding_triples {
        models.push(row(
            "stored triple",
            format!(
                "{}/{} dim {}: {} rows",
                triple.provider, triple.model, triple.dim, triple.count
            ),
        ));
    }
    let models = HealthSection {
        title: "Embedder and models",
        rows: models,
    };
    let index = HealthSection {
        title: "Index and storage",
        rows: vec![
            row(
                "fts",
                format!(
                    "pages {}/{}; observations {}/{}",
                    s.derived.pages_fts_rows,
                    s.derived.pages_rows,
                    s.derived.observations_fts_rows,
                    s.derived.observations_rows
                ),
            ),
            row(
                "database",
                format!(
                    "{} bytes, {} reclaimable",
                    s.storage.database_bytes, s.storage.reclaimable_bytes
                ),
            ),
        ],
    };
    vec![hooks, local, consolidation, models, index]
}

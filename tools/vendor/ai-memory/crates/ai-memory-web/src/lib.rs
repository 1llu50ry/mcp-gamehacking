//! `ai-memory-web` — read-only HTTP browser for the wiki.
//!
//! Mounted under `/web` on the same axum server that hosts the MCP
//! endpoint, so a single port + single auth posture covers both. The
//! crate is deliberately read-only in v1: no editing, no POST routes,
//! no agent-write APIs. The wiki is already markdown-on-disk; this
//! surface just makes it browsable from a phone, a tablet, or a
//! teammate's machine without `docker exec cat …`.
//!
//! Routes (all under whatever prefix the host nests this router at):
//! - `GET /`                              → project list (cards)
//! - `GET /graph`                         → cross-project link graph (SVG + table)
//! - `GET /w/:workspace/:project`         → page tree + recent activity
//! - `GET /w/:workspace/:project/graph`   → in-project link graph (SVG + table)
//! - `GET /w/:workspace/:project/p/*path` → rendered markdown + metadata
//! - `GET /w/:workspace/:project/h/*path` → version history + unified diff
//! - `GET /w/:workspace/:project/s/:session` → session timeline, paged
//! - `GET /search?q=…`                    → cross-project FTS5 hit list
//! - `GET /search?q=…&workspace=…&project=…&explain=1` → project search
//!   through `memory_query`'s hybrid ranker, with the recall trace
//! - `GET /pending`                       → root-only pending-writes triage;
//!   its buttons post to `/admin/pending-writes/*`, not to this crate
//! - `GET /workstreams`                   → root-only managed-run operations
//!   overview derived from trusted lifecycle fields
//! - `GET /health`                        → root-only server health panel
//! - `GET /login` / `GET /change-password` → public human-auth HTML forms
//! - `GET /static/*`                      → embedded CSS + logo (public)
//!
//! The companion `api_router` exposes the same read-only data as JSON
//! for custom frontends. It intentionally does not expose write/admin
//! operations. `clippy.toml` in this crate forbids the `Wiki` write and
//! destructive methods, so read-only holds at lint time, not only by review.
//!
//! Theme follows `prefers-color-scheme` via the included Tailwind
//! stylesheet; no JS toggle, no cookie.

use std::sync::Arc;

use ai_memory_store::ReaderPool;
use ai_memory_wiki::Wiki;
use axum::Router;

mod diff;
pub mod health;
mod html_auth;
#[cfg(feature = "management-ui")]
pub mod management;
mod markdown;
pub mod mount;
pub mod recall;
mod routes;
mod state;
mod templates;

pub use html_auth::{HtmlAuthRedirectConfig, html_auth_redirect_mw, sanitize_next};
pub use mount::{
    SplitWebRouters, WebMountSpec, inject_base_href, inject_base_path_meta, normalize_prefix,
    split_web_routers, web_base_href,
};
pub use recall::Recall;
pub use state::WebState;

/// Build the read-only web router. Call once at server startup and
/// `nest("/web", router)` it onto the existing axum app, OR mount at
/// `/` if the web UI is the only HTTP surface.
pub fn router(reader: ReaderPool, wiki: Wiki) -> Router {
    let state = Arc::new(WebState::new(reader, wiki));
    routes::build(state)
}

/// Build the read-only JSON API router for third-party web UIs.
///
/// The host should `nest("/api/v1", api_router(...))` behind its normal auth
/// boundary, with or without `/web`, so external clients can browse memory
/// without reading SQLite or wiki files directly.
pub fn api_router(reader: ReaderPool, wiki: Wiki) -> Router {
    let state = Arc::new(WebState::new(reader, wiki));
    routes::build_api(state)
}

/// Standalone `GET /favicon.ico` router. Merge at the host-root level
/// (NOT under `--base-path`, NOT nested under `/web`) so the browser's
/// automatic `/favicon.ico` fetch actually reaches it. The handler is
/// stateless — it returns the same embedded PNG as `/web/static/logo.png`.
pub fn favicon_router() -> Router {
    routes::build_favicon()
}

// Integration tests compile into this crate's test harness instead of a
// separate binary: every test binary is another link and, on macOS and
// Windows, another first-run malware scan. They still exercise only the
// public API; `extern crate self` lets them keep addressing it by crate name.
#[cfg(test)]
extern crate self as ai_memory_web;
// The fixtures seed pages through `Wiki::write_page`, which `clippy.toml`
// forbids in this crate's own code.
#[cfg(test)]
#[allow(clippy::disallowed_methods)]
#[path = "../tests/suite/mod.rs"]
mod integration;

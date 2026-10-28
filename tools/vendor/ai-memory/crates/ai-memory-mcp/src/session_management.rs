//! Browser-session management. Machine credentials never authenticate this surface.

use std::sync::Arc;

use ai_memory_core::{
    ActorContext, AuthLevel, AuthorizedViewer, Capability, OwnerFilter, SessionId, UserId,
};
use ai_memory_store::{
    Compaction, ObservationOrder, ObservationPage, ProjectAccess, PurgeMode, ReaderPool,
    StoreError, WriterHandle,
};
use ai_memory_wiki::{AdmissionContext, AdmissionOp, Wiki};
use axum::extract::{Path, Query, State};
use axum::http::{Request, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::AuthState;
use crate::human_auth::require_session;

// Bounds browser reads. Returned with each page so client offsets cannot drift.
const MANAGEMENT_PAGE_SIZE: usize = 50;

/// Dependencies resolved once at server startup.
#[derive(Clone)]
pub struct SessionManagementState {
    /// Read pool; all listings remain scope/owner filtered.
    pub reader: ReaderPool,
    /// Single writer actor.
    pub writer: WriterHandle,
    /// Canonical disk/SQL mutation path.
    pub wiki: Wiki,
}

/// Authenticated JSON routes for the opt-in management console.
/// Browser cookies and CSRF use the existing human-auth middleware.
/// Callers mount this only when the runtime switch is enabled.
pub fn router(state: SessionManagementState, auth: Arc<AuthState>) -> Router {
    Router::new()
        .route("/management/v1/projects", get(projects))
        .route("/management/v1/sessions", get(sessions))
        .route(
            "/management/v1/sessions/{id}/observations",
            get(observations),
        )
        .route("/management/v1/sessions/{id}/purge", post(purge))
        .with_state(Arc::new(state))
        .layer(middleware::from_fn(ready))
        .layer(middleware::from_fn_with_state(auth, require_session))
        .layer(middleware::from_fn(no_store))
}

async fn no_store(req: Request<axum::body::Body>, next: Next) -> Response {
    let mut response = next.run(req).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, no-store"),
    );
    response
}

async fn ready(
    Extension(live): Extension<ai_memory_store::LiveWebSession>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    if live.user.must_change_password {
        return error(StatusCode::FORBIDDEN, "password change required");
    }
    next.run(req).await
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

fn store_error(e: StoreError) -> Response {
    match e {
        StoreError::NotFound(_) => error(StatusCode::NOT_FOUND, "not found"),
        StoreError::Forbidden(message) => error(StatusCode::FORBIDDEN, message),
        StoreError::InvalidState(message) => error(StatusCode::CONFLICT, &message),
        other => {
            tracing::warn!(error = %other, "management store operation failed");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "management operation failed",
            )
        }
    }
}

fn is_admin(level: AuthLevel) -> bool {
    level.authorize(Capability::Admin, true).is_ok()
}

fn owners(level: AuthLevel, actor: &ActorContext) -> OwnerFilter {
    if is_admin(level) {
        OwnerFilter::Any
    } else {
        OwnerFilter::for_actor_context(actor)
    }
}

#[derive(Deserialize)]
struct ScopeQuery {
    workspace: String,
    project: String,
    #[serde(default)]
    offset: usize,
}

async fn scope(
    state: &SessionManagementState,
    q: &ScopeQuery,
    viewer: Option<Extension<AuthorizedViewer>>,
    access: ProjectAccess,
) -> Result<ai_memory_store::ResolvedScope, Response> {
    ai_memory_store::lookup_existing_scope_guarded(
        &state.reader,
        &q.workspace,
        &q.project,
        viewer.map(|Extension(v)| v.user()),
        access,
    )
    .await
    .map_err(|e| {
        if e.is_forbidden() {
            error(StatusCode::FORBIDDEN, "project access denied")
        } else if e.is_not_found() {
            error(StatusCode::NOT_FOUND, "project not found")
        } else {
            error(StatusCode::BAD_REQUEST, "invalid scope")
        }
    })
}

async fn projects(
    State(state): State<Arc<SessionManagementState>>,
    viewer: Option<Extension<AuthorizedViewer>>,
) -> Result<Json<Value>, Response> {
    let projects = state
        .reader
        .list_projects_with_stats(viewer.map(|Extension(v)| v.user()))
        .await
        .map_err(store_error)?;
    Ok(Json(json!({"projects": projects})))
}

async fn sessions(
    State(state): State<Arc<SessionManagementState>>,
    Query(q): Query<ScopeQuery>,
    viewer: Option<Extension<AuthorizedViewer>>,
    Extension(level): Extension<AuthLevel>,
    Extension(actor): Extension<ActorContext>,
) -> Result<Json<Value>, Response> {
    let s = scope(&state, &q, viewer, ProjectAccess::Read).await?;
    let sessions = state
        .reader
        .sessions_for_scope(
            s.workspace_id,
            s.project_id,
            owners(level, &actor),
            true,
            MANAGEMENT_PAGE_SIZE,
            q.offset,
        )
        .await
        .map_err(store_error)?;
    Ok(Json(
        json!({"sessions": sessions, "page_size": MANAGEMENT_PAGE_SIZE}),
    ))
}

async fn observations(
    State(state): State<Arc<SessionManagementState>>,
    Query(q): Query<ScopeQuery>,
    Path(id): Path<SessionId>,
    viewer: Option<Extension<AuthorizedViewer>>,
    Extension(level): Extension<AuthLevel>,
    Extension(actor): Extension<ActorContext>,
) -> Result<Json<Value>, Response> {
    let s = scope(&state, &q, viewer, ProjectAccess::Read).await?;
    if state
        .reader
        .session_summary_scoped(s.workspace_id, s.project_id, id, owners(level, &actor))
        .await
        .map_err(store_error)?
        .is_none()
    {
        return Err(error(StatusCode::NOT_FOUND, "session not found"));
    }
    let page = state
        .reader
        .session_observations_scoped(
            s.workspace_id,
            s.project_id,
            id,
            ObservationPage {
                limit: MANAGEMENT_PAGE_SIZE,
                offset: q.offset,
                order: ObservationOrder::Asc,
                kinds: None,
                query: None,
            },
        )
        .await
        .map_err(store_error)?;
    Ok(Json(json!({
        "records": page.records,
        "total": page.total,
        "elided_other_scope": page.elided_other_scope,
        "page_size": MANAGEMENT_PAGE_SIZE,
    })))
}

#[derive(Deserialize)]
struct PurgeBody {
    workspace: String,
    project: String,
    #[serde(default)]
    confirm: bool,
    #[serde(default)]
    dry_run: bool,
}

async fn purge(
    State(state): State<Arc<SessionManagementState>>,
    Path(id): Path<SessionId>,
    viewer: Option<Extension<AuthorizedViewer>>,
    Extension(level): Extension<AuthLevel>,
    Extension(actor): Extension<ActorContext>,
    Extension(user): Extension<UserId>,
    Json(body): Json<PurgeBody>,
) -> Result<Json<Value>, Response> {
    let q = ScopeQuery {
        workspace: body.workspace,
        project: body.project,
        offset: 0,
    };
    let s = scope(&state, &q, viewer, ProjectAccess::Write).await?;
    let admin = is_admin(level);
    let owner = actor
        .identity_key()
        .ok_or_else(|| error(StatusCode::FORBIDDEN, "operator identity required"))?;
    // Refuse before admission/checkpoint side effects; the writer rechecks inside its transaction.
    let session = state
        .reader
        .session_summary_scoped(s.workspace_id, s.project_id, id, owners(level, &actor))
        .await
        .map_err(store_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "session not found"))?;
    if !admin && session.actor_user.as_deref() != Some(owner.storage_key().as_str()) {
        return Err(error(StatusCode::NOT_FOUND, "session not found"));
    }
    // Preflight collateral before admission/checkpoints; the writer repeats
    // this check at commit so a changed grant or session cannot race deletion.
    let preview = if admin {
        state
            .writer
            .purge_session(
                s.workspace_id,
                s.project_id,
                id,
                Some(user),
                Compaction::Skip,
                PurgeMode::Preview,
            )
            .await
    } else {
        state
            .writer
            .purge_owned_session(
                s.workspace_id,
                s.project_id,
                id,
                owner.clone(),
                Some(user),
                PurgeMode::Preview,
            )
            .await
    }
    .map_err(store_error)?;
    if body.dry_run {
        return Ok(Json(report(&preview, true, &[], &[])));
    }
    if !body.confirm {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "destructive operation requires confirm=true",
        ));
    }
    // Both human and machine administration use the same Wiki primitives.
    // This orchestration stays explicit here because self-service must recheck
    // exact ownership and project grants, unlike the root-only admin surface.
    let dispatch = state
        .wiki
        .admit_purge_session(
            s.workspace_id,
            s.project_id,
            Some(AdmissionContext {
                workspace: q.workspace,
                project: q.project,
                op: AdmissionOp::PurgeSession,
                actor,
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "purge admission failed");
            error(StatusCode::CONFLICT, "purge was refused")
        })?;
    state
        .wiki
        .commit_all(&format!("pre-management-purge-session {id}"))
        .map_err(|e| {
            tracing::warn!(error = %e, "purge checkpoint failed");
            error(StatusCode::INTERNAL_SERVER_ERROR, "checkpoint failed")
        })?;
    let outcome = if admin {
        state
            .wiki
            .purge_session(
                s.workspace_id,
                s.project_id,
                id,
                Some(user),
                Compaction::Skip,
            )
            .await
    } else {
        state
            .wiki
            .purge_owned_session(s.workspace_id, s.project_id, id, owner, Some(user))
            .await
    }
    .map_err(|e| match e {
        ai_memory_wiki::WikiError::Store(e) => store_error(e),
        other => {
            tracing::warn!(error = %other, "session purge failed");
            error(StatusCode::INTERNAL_SERVER_ERROR, "session purge failed")
        }
    })?;
    let mut dispatch = dispatch;
    if let Some(ctx) = dispatch.as_mut() {
        ctx.partial_failure = !outcome.files_failed.is_empty();
    }
    state.wiki.dispatch_purge(dispatch.as_ref());
    if let Err(e) = state
        .wiki
        .commit_all(&format!("management-purge-session {id}"))
    {
        tracing::warn!(error = %e, "post-purge checkpoint failed");
    }
    Ok(Json(report(
        &outcome.summary,
        false,
        &outcome.files_deleted,
        &outcome.files_failed,
    )))
}

fn report(
    s: &ai_memory_store::PurgeSessionSummary,
    dry_run: bool,
    deleted: &[ai_memory_core::PagePath],
    failed: &[ai_memory_core::PagePath],
) -> Value {
    json!({"dry_run": dry_run, "observations_deleted": s.observations_deleted, "handoffs_deleted": s.handoffs_deleted, "pages_deleted": s.pages_deleted, "auto_improve_runs_deleted": s.auto_improve_runs_deleted, "removed_paths": s.removed_paths, "collateral_observations_deleted": s.collateral_observations_deleted, "collateral_handoffs_denulled": s.collateral_handoffs_denulled, "files_deleted": deleted, "files_failed": failed})
}

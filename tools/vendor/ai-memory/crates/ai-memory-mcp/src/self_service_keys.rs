//! Personal native API keys through existing browser-session authentication.
use crate::{auth::AuthState, human_auth::require_session};
use ai_memory_core::{ApiCredentialId, UserId};
use ai_memory_store::{ReaderPool, StoreError, TokenPepper, WriterHandle};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

/// Longest label a user may give a self-issued key, in characters.
pub const MAX_LABEL_CHARS: usize = 128;
/// Active (unrevoked, unexpired) self-issued keys one user may hold at once.
pub const MAX_ACTIVE_KEYS_PER_USER: usize = 20;

/// Dependencies resolved once at startup; credentials never read server config.
#[derive(Clone)]
pub struct SelfServiceKeysState {
    /// Read pool for credential ownership.
    pub reader: ReaderPool,
    /// Existing single writer.
    pub writer: WriterHandle,
    /// Server-configured native-key pepper.
    pub pepper: Option<TokenPepper>,
}
/// Human sessions only. Machine bearers and pending password changes are refused.
pub fn router(state: SelfServiceKeysState, auth: Arc<AuthState>) -> Router {
    Router::new()
        .route(
            "/management/v1/credentials",
            get(credentials).post(create_credential),
        )
        .route(
            "/management/v1/credentials/{id}/revoke",
            post(revoke_credential),
        )
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

async fn credentials(
    State(state): State<Arc<SelfServiceKeysState>>,
    Extension(user): Extension<UserId>,
) -> Result<Json<Value>, Response> {
    Ok(Json(
        json!({"credentials": state.reader.list_api_credentials_for_user(user).await.map_err(store_error)?}),
    ))
}

#[derive(Deserialize)]
struct KeyBody {
    label: String,
}

async fn create_credential(
    State(state): State<Arc<SelfServiceKeysState>>,
    Extension(user): Extension<UserId>,
    Json(body): Json<KeyBody>,
) -> Result<Json<Value>, Response> {
    let label = body.label.trim();
    if label.is_empty() || label.chars().count() > MAX_LABEL_CHARS {
        return Err(error(
            StatusCode::BAD_REQUEST,
            &format!("label must be 1 to {MAX_LABEL_CHARS} characters after trimming"),
        ));
    }
    let pepper = state
        .pepper
        .as_ref()
        .ok_or_else(|| error(StatusCode::CONFLICT, "API keys are not configured"))?;
    let token = ai_memory_store::generate_api_key().map_err(store_error)?;
    let id = state
        .writer
        .create_api_credential_within_limit(
            ApiCredentialId::new(),
            user,
            label.to_owned(),
            ai_memory_store::hash_token(&token, pepper),
            Some(ai_memory_store::api_key_preview(&token)),
            MAX_ACTIVE_KEYS_PER_USER,
        )
        .await
        .map_err(store_error)?;
    Ok(Json(json!({"id": id, "token": token})))
}

async fn revoke_credential(
    State(state): State<Arc<SelfServiceKeysState>>,
    Extension(user): Extension<UserId>,
    Path(id): Path<ApiCredentialId>,
) -> Result<Json<Value>, Response> {
    let key = state
        .reader
        .find_api_credential(id)
        .await
        .map_err(store_error)?
        // A foreign id and an already-revoked one both read as absent, so
        // the response never confirms another user's credential exists.
        .filter(|key| key.user_id == user && key.revoked_at.is_none())
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "credential not found"))?;
    state
        .writer
        .revoke_api_credential(key.id)
        .await
        .map_err(store_error)?;
    Ok(Json(json!({"revoked": true})))
}

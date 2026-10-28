//! Adversarial management tests exercise real cookie/CSRF and writer isolation.
use ai_memory_core::{NewUser, UserId, UserRole};
use ai_memory_mcp::{
    HumanAuthRuntime,
    auth::AuthState,
    human_auth::LoginLimiter,
    self_service_keys::{SelfServiceKeysState as ManagementState, router},
};
use ai_memory_store::{Store, TokenPepper, hash_session_secret};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use std::sync::Arc;
use tempfile::TempDir;
use tower::ServiceExt;

struct Browser {
    cookie: String,
    csrf: String,
    user: UserId,
}
struct Harness {
    _tmp: TempDir,
    store: Store,
    router: Router,
    alice: Browser,
    bob: Browser,
    root: Browser,
}

async fn browser(store: &Store, name: &str, role: UserRole, must_change: bool) -> Browser {
    let phc = ai_memory_store::password::hash_password("password-for-test".into())
        .await
        .unwrap();
    let user = store
        .writer
        .create_human_user(
            NewUser {
                username: name.into(),
                name: None,
                email: None,
            },
            role,
            Some(phc.clone()),
            must_change,
        )
        .await
        .unwrap();
    let secret = ai_memory_store::web_sessions::generate_session_secret().unwrap();
    let csrf = ai_memory_store::web_sessions::generate_csrf_secret().unwrap();
    store
        .writer
        .issue_web_session(
            user,
            phc,
            role,
            must_change,
            hash_session_secret(&secret),
            hash_session_secret(&csrf),
        )
        .await
        .unwrap();
    Browser {
        user,
        cookie: format!("ai_memory_session={secret}; ai_memory_csrf={csrf}"),
        csrf,
    }
}
async fn harness() -> Harness {
    let tmp = TempDir::new().unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let alice = browser(&store, "alice", UserRole::User, false).await;
    let bob = browser(&store, "bob", UserRole::User, false).await;
    let root = browser(&store, "root", UserRole::Root, false).await;
    let auth = Arc::new(
        AuthState::new(Some("root-bearer".into())).with_human(HumanAuthRuntime {
            reader: store.reader.clone(),
            writer: store.writer.clone(),
            recovery_token_hash: None,
            root_username: "root".into(),
            root_name: None,
            root_email: None,
            reserved_passwords: vec![],
            trusted_proxy_cidrs: vec![],
            limiter: Arc::new(LoginLimiter::default()),
        }),
    );
    let router = router(
        ManagementState {
            reader: store.reader.clone(),
            writer: store.writer.clone(),
            pepper: Some(TokenPepper::new("test-pepper")),
        },
        auth,
    );
    Harness {
        _tmp: tmp,
        store,
        router,
        alice,
        bob,
        root,
    }
}
async fn call(
    h: &Harness,
    browser: Option<&Browser>,
    method: &str,
    uri: &str,
    body: Value,
    csrf: bool,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(browser) = browser {
        request = request.header("cookie", &browser.cookie);
        if csrf {
            request = request.header("x-csrf-token", &browser.csrf);
        }
    }
    let response = h
        .router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1_000_000)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn self_service_keys_refuse_foreign_ids_csrf_machine_and_pending_password_with_owner_controls()
 {
    let h = harness().await;
    let path = "/management/v1/credentials";
    assert_eq!(
        call(&h, None, "GET", path, Value::Null, false).await.0,
        StatusCode::UNAUTHORIZED
    );
    let response = h
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .header("authorization", "Bearer root-bearer")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        call(
            &h,
            Some(&h.alice),
            "POST",
            path,
            json!({"label":"missing-csrf"}),
            false
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let pending = browser(&h.store, "pending", UserRole::User, true).await;
    assert_eq!(
        call(
            &h,
            Some(&pending),
            "POST",
            path,
            json!({"label":"refused"}),
            true
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let issued = call(
        &h,
        Some(&h.alice),
        "POST",
        path,
        json!({"label":"own key","username":"bob"}),
        true,
    )
    .await;
    assert_eq!(issued.0, StatusCode::OK);
    assert!(issued.1["token"].as_str().unwrap().starts_with("aim_"));
    let credentials = h
        .store
        .reader
        .list_api_credentials_for_user(h.alice.user)
        .await
        .unwrap();
    assert_eq!(credentials.len(), 1);
    assert_eq!(credentials[0].user_id, h.alice.user);
    assert!(
        h.store
            .reader
            .list_api_credentials_for_user(h.bob.user)
            .await
            .unwrap()
            .is_empty()
    );
    let revoke = format!(
        "/management/v1/credentials/{}/revoke",
        issued.1["id"].as_str().unwrap()
    );
    assert_eq!(
        call(&h, Some(&h.bob), "POST", &revoke, json!({}), true)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&h, Some(&h.alice), "POST", &revoke, json!({}), false)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert!(
        h.store
            .reader
            .list_api_credentials_for_user(h.alice.user)
            .await
            .unwrap()[0]
            .revoked_at
            .is_none()
    );
    assert_eq!(
        call(&h, Some(&h.alice), "POST", &revoke, json!({}), true)
            .await
            .0,
        StatusCode::OK
    );
    assert!(
        h.store
            .reader
            .list_api_credentials_for_user(h.alice.user)
            .await
            .unwrap()[0]
            .revoked_at
            .is_some()
    );
    // A root browser also issues only a key owned by its immutable user id.
    assert_eq!(
        call(
            &h,
            Some(&h.root),
            "POST",
            path,
            json!({"label":"root's machine key"}),
            true
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        h.store
            .reader
            .list_api_credentials_for_user(h.root.user)
            .await
            .unwrap()
            .len(),
        1
    );
}

const KEYS: &str = "/management/v1/credentials";

async fn active_keys(h: &Harness, user: UserId) -> Vec<ai_memory_core::ApiCredential> {
    h.store
        .reader
        .list_api_credentials_for_user(user)
        .await
        .unwrap()
        .into_iter()
        .filter(|key| key.revoked_at.is_none())
        .collect()
}

async fn issue(h: &Harness, who: &Browser, label: &str) -> (StatusCode, Value) {
    call(h, Some(who), "POST", KEYS, json!({ "label": label }), true).await
}

#[tokio::test]
async fn self_service_keys_refuse_blank_and_overlong_labels() {
    let h = harness().await;
    for label in [String::new(), "   \t ".into(), "x".repeat(129)] {
        let (status, body) = issue(&h, &h.alice, &label).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "label {label:?}");
        assert!(body.get("token").is_none());
    }
    // Multi-byte characters count as characters, not bytes.
    let (status, body) = issue(&h, &h.alice, &"é".repeat(129)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.get("token").is_none());
    assert!(active_keys(&h, h.alice.user).await.is_empty());

    // Controls: the limit itself is accepted, and labels are stored trimmed.
    assert_eq!(
        issue(&h, &h.alice, &"é".repeat(128)).await.0,
        StatusCode::OK
    );
    assert_eq!(issue(&h, &h.alice, "  laptop  ").await.0, StatusCode::OK);
    let labels: Vec<String> = active_keys(&h, h.alice.user)
        .await
        .into_iter()
        .map(|key| key.label)
        .collect();
    assert_eq!(labels.len(), 2);
    assert!(labels.contains(&"laptop".to_string()));
}

#[tokio::test]
async fn self_service_keys_cap_active_keys_per_user() {
    let h = harness().await;
    let max = ai_memory_mcp::self_service_keys::MAX_ACTIVE_KEYS_PER_USER;
    let mut first = None;
    for n in 0..max {
        let (status, body) = issue(&h, &h.alice, &format!("key {n}")).await;
        assert_eq!(status, StatusCode::OK, "key {n}");
        first.get_or_insert_with(|| body["id"].as_str().unwrap().to_string());
    }
    let (status, body) = issue(&h, &h.alice, "one too many").await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.get("token").is_none());
    assert!(
        body["error"].as_str().unwrap().contains("limit"),
        "unclear refusal: {body}"
    );
    assert_eq!(active_keys(&h, h.alice.user).await.len(), max);

    // The cap is per user: another user still issues keys.
    assert_eq!(issue(&h, &h.bob, "bob's key").await.0, StatusCode::OK);
    // Revoked keys do not count: revoking one frees a slot.
    let revoke = format!("{KEYS}/{}/revoke", first.unwrap());
    assert_eq!(
        call(&h, Some(&h.alice), "POST", &revoke, json!({}), true)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(issue(&h, &h.alice, "replacement").await.0, StatusCode::OK);
    assert_eq!(active_keys(&h, h.alice.user).await.len(), max);
}

#[tokio::test]
async fn self_service_keys_refuse_a_disabled_user() {
    let h = harness().await;
    assert_eq!(issue(&h, &h.alice, "before").await.0, StatusCode::OK);
    let id = active_keys(&h, h.alice.user).await[0].id;
    h.store
        .writer
        .set_user_disabled(h.alice.user, true)
        .await
        .unwrap();

    assert_eq!(
        call(&h, Some(&h.alice), "GET", KEYS, Value::Null, false)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        issue(&h, &h.alice, "after").await.0,
        StatusCode::UNAUTHORIZED
    );
    let revoke = format!("{KEYS}/{id}/revoke");
    assert_eq!(
        call(&h, Some(&h.alice), "POST", &revoke, json!({}), true)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(active_keys(&h, h.alice.user).await.len(), 1);
    // Control: an enabled user is unaffected.
    assert_eq!(issue(&h, &h.bob, "bob").await.0, StatusCode::OK);
}

#[tokio::test]
async fn self_service_keys_revoking_an_unknown_or_revoked_id_is_not_found() {
    let h = harness().await;
    let alice_key = issue(&h, &h.alice, "alice").await.1["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(issue(&h, &h.bob, "bob").await.0, StatusCode::OK);

    let unknown = format!("{KEYS}/{}/revoke", ai_memory_core::ApiCredentialId::new());
    assert_eq!(
        call(&h, Some(&h.alice), "POST", &unknown, json!({}), true)
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    let revoke = format!("{KEYS}/{alice_key}/revoke");
    assert_eq!(
        call(&h, Some(&h.alice), "POST", &revoke, json!({}), true)
            .await
            .0,
        StatusCode::OK
    );
    let revoked_at = h
        .store
        .reader
        .list_api_credentials_for_user(h.alice.user)
        .await
        .unwrap()[0]
        .revoked_at;
    assert!(revoked_at.is_some());
    assert_eq!(
        call(&h, Some(&h.alice), "POST", &revoke, json!({}), true)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    // The repeat neither moved the original revocation time nor touched
    // another user's key.
    assert_eq!(
        h.store
            .reader
            .list_api_credentials_for_user(h.alice.user)
            .await
            .unwrap()[0]
            .revoked_at,
        revoked_at
    );
    assert_eq!(active_keys(&h, h.bob.user).await.len(), 1);
}

# Self-service MCP API keys

Start the HTTP server with `--enable-self-service-keys`
(`AI_MEMORY_ENABLE_SELF_SERVICE_KEYS=true`). It is off by default and requires
`--transport http`. Existing human browser sessions may GET or POST
`/management/v1/credentials` and POST `/management/v1/credentials/{id}/revoke`.
Machine bearers and password-change-required sessions cannot use these routes;
mutations require the existing CSRF cookie/header pair.

POST a `label` to create a key for the authenticated immutable user id. The
server returns the `aim_` key once and stores only its peppered hash. The
label is trimmed and must be 1 to 128 characters (400 otherwise). A user may
hold at most 20 active keys; the 21st is refused with 409 until one is
revoked. Configure `[auth] token_pepper` as for the existing native-key
administration commands. Revocation answers 404 for another user's credential
id, an unknown id, or a key that is already revoked, so it never confirms that
someone else's key exists. Listing returns metadata and previews, never token
material. Responses use `Cache-Control: private, no-store`.

Use the key as an Authorization: Bearer credential for `/mcp` and lifecycle
hooks. It remains User-level even when its owner is an Admin. A password reset
or an account disable ends browser sessions but does not revoke self-issued
keys; revoke them separately. No identity provider, password implementation,
database, or schema is added.

Run `cargo t -p ai-memory-mcp -E 'test(/self_service_keys/)'` for the adversarial
anonymous, machine, CSRF, pending-password, disabled-user, foreign, unknown and
revoked id, label, key-limit, and legitimate owner tests.

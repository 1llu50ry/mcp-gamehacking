# Two-operator acceptance harness

Brings up one server behind an SSO-terminating proxy and drives it as three
different people, so the multi-operator boundary can be exercised end to end
rather than only in unit tests.

```sh
docker build -f docker/Dockerfile -t ai-memory:multiuser-test .
cd docker/multiuser-test && docker compose up -d && ./drive.sh
```

| Port | Who | How the proxy names them |
|---|---|---|
| 8081 | alice | `X-Memory-Actor-User: alice` |
| 8082 | bob | `X-Memory-Actor-User: bob` |
| 8083 | carol | `X-Memory-Actor-Issuer` + `X-Memory-Actor-Sub`, with no `preferred_username` |
| 49374 | — | the server unproxied, for the seed step and the negative cases |

Slot namespaces are `IdentityKey::path_segment()` values, never raw names:
alice's slots live under `_slots/u-alice/`, bob's under `_slots/u-bob/`, and
carol's under a bounded `_slots/o-<uuid>/` component derived from the complete
issuer/subject pair. The prefixes keep a username from aliasing an OIDC
identity, and every component is filesystem- and GLOB-safe.

`nginx.conf` uses `proxy_set_header`, which **replaces** rather than appends.
That is the requirement `docs/users.md` places on the operator: with an
appending ingress the client's own value arrives first and would be the one
read. The harness therefore doubles as a worked example of the safe config.

Port 8083 covers an OIDC ingress without a display username. The issuer and
subject must remain paired so equal subjects from different issuers never
share a slot namespace.

The unproxied port covers the two negatives nginx cannot produce: a client
forging `X-Memory-Actor-*` while using the root bearer (must be ignored), and a
**duplicated** actor header presented with the proxy bearer (must fail closed
with 400, not silently resolve to one of the two identities).

Section B (handoff ownership) is **skipped by default** so this harness can be
used specifically for slot acceptance. Include it with
`AI_MEMORY_TEST_HANDOFF_OWNERSHIP=1 ./drive.sh`.

`drive.sh` asserts against `/handoff?briefing=1`, not `memory_briefing`. The
briefing tool returns paths and titles only, so asserting "no slot body leaked"
against it passes whether or not the filter works. The session brief is the
surface that carries slot **bodies** into an agent's context, which is the
channel worth defending.

The credentials in `config.toml` are throwaway strings for a loopback-only
container. Generate real ones with `ai-memory generate-auth-token`.

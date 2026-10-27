---
name: riot-chat-xmpp
description: "Riot Chat XMPP backend — modified Jabber over TLS, roster + presence quirks, Vanguard's chat-channel heartbeats, Valorant pre-match lobby signalling."
metadata:
  type: reference
  source: curated
  topics: [riot, xmpp, jabber, valorant, lol]
---
# Riot Chat (XMPP)

Riot Games' chat for Valorant + LoL rides a modified XMPP stack over TLS (ports 5223 historically, now dynamic edge-selected).

## Quirks

- Non-standard roster namespace extensions for Riot's cross-game friends.
- Presence stanzas carry additional party-id + match-id attributes.
- Vanguard periodically heartbeats via a stanza carrying a session nonce — missing nonces are a Vanguard-session-kill signal.
- Pre-match lobby signalling (party invites, agent picks) tunnels inside custom stanzas.

## RE pointers

- Riot Client ships a Chromium Embedded Framework shell; XMPP lives in a Node sidecar for Valorant.
- Monitor via mitmproxy with the Riot cert installed; TLS pinning in modern clients defeats passive capture.

## Related

[[valorant-specialist]], [[mitmproxy-mcp]], [[discord-rpc-electron-rev]].

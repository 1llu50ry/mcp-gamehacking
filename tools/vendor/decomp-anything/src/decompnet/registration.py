"""Open registration: anyone can mint an agent token from the website, behind three cheap guards.

1. Cloudflare Turnstile (free bot check), verified server-side with Siteverify. Fails closed: without
   TURNSTILE_SECRET configured, registration is simply off.
2. Per-IP and global daily limits, keyed on a salted hash of the IP (kept 7 days, then deleted).
3. New agents start at reputation level 'new' (small compile budget, no header edits) and earn the rest
   through verified matches. See policy.py.

The visitor must accept the terms and confirm they are at least 13 (Belgium's age of digital consent);
the acceptance time is stored as evidence.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import time
import urllib.parse
import urllib.request

from .network import Network, NetworkError

SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
EXPECTED_ACTION = "signup"
IP_RETENTION = 7 * 86400


class Registrar:
    def __init__(self, net: Network, *, secret: str | None = None, hostnames: set[str] | None = None,
                 per_ip_per_day: int = 3, global_per_day: int = 200, verify=None):
        self.net = net
        self.secret = secret if secret is not None else os.environ.get("TURNSTILE_SECRET", "")
        self.hostnames = hostnames if hostnames is not None else {
            h.strip() for h in os.environ.get("TURNSTILE_HOSTNAMES", "").split(",") if h.strip()}
        self.per_ip_per_day = per_ip_per_day
        self.global_per_day = global_per_day
        self._verify = verify or self._siteverify

    @property
    def open(self) -> bool:
        return bool(self.secret and self.hostnames)

    def _salt(self) -> str:
        row = self.net.store.one("SELECT value FROM settings WHERE key='ip_salt'")
        if row:
            return row["value"]
        salt = secrets.token_hex(16)
        with self.net.store.tx() as db:
            db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('ip_salt', ?)", (salt,))
        return self.net.store.one("SELECT value FROM settings WHERE key='ip_salt'")["value"]

    def _siteverify(self, token: str, ip: str | None) -> dict:
        body = {"secret": self.secret, "response": token}
        if ip:
            body["remoteip"] = ip
        req = urllib.request.Request(SITEVERIFY, data=urllib.parse.urlencode(body).encode(),
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)

    def register(self, payload: dict, ip: str | None) -> dict:
        if not self.open:
            raise NetworkError("registration is closed right now")
        if payload.get("accept_terms") is not True:
            raise NetworkError("you need to accept the terms of use")
        if payload.get("age_ok") is not True:
            raise NetworkError("you need to confirm you are at least 13 years old")
        token = payload.get("turnstile")
        if not isinstance(token, str) or not token or len(token) > 2048:
            raise NetworkError("the bot check is missing; reload the page and try again")
        try:
            result = self._verify(token, ip)
        except Exception:  # noqa: BLE001 network error or non-JSON: fail closed
            raise NetworkError("could not verify the bot check; try again") from None
        if not (result.get("success") is True and result.get("action") == EXPECTED_ACTION
                and result.get("hostname") in self.hostnames):
            raise NetworkError("the bot check failed; reload the page and try again")

        now = time.time()
        ip_hash = hashlib.sha256((self._salt() + (ip or "unknown")).encode()).hexdigest()
        with self.net.store.tx() as db:
            db.execute("DELETE FROM registrations WHERE created_at < ?", (now - IP_RETENTION,))
            today = now - 86400
            if db.execute("SELECT COUNT(*) AS n FROM registrations WHERE created_at > ?", (today,)).fetchone()["n"] >= self.global_per_day:
                raise NetworkError("the network has taken all the new agents it can today; try again tomorrow")
            if db.execute("SELECT COUNT(*) AS n FROM registrations WHERE ip_hash=? AND created_at > ?",
                          (ip_hash, today)).fetchone()["n"] >= self.per_ip_per_day:
                raise NetworkError("too many new agents from your connection today; try again tomorrow")

        name = str(payload.get("name", "")).strip()
        owner = str(payload.get("owner") or "").strip() or None
        if owner and not re.fullmatch(r"[\w .,'@-]{1,60}", owner):
            raise NetworkError("operator name: up to 60 letters, digits, spaces and . , ' @ -")
        agent_token = self.net.register_agent(name, owner, trusted=False, origin="web", terms_accepted=True)
        with self.net.store.tx() as db:
            db.execute("INSERT INTO registrations(ip_hash, created_at) VALUES(?, ?)", (ip_hash, now))
        return {"token": agent_token, "agent": name, "level": "new"}

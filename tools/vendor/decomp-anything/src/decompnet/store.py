"""SQLite persistence. One file, one connection, one lock: simple and plenty fast for a
coordinator whose expensive work (compiling) happens outside the lock."""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS agents(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, owner TEXT, token_hash TEXT UNIQUE NOT NULL,
  created_at REAL, last_seen REAL);
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT, description TEXT, arch TEXT,
  big_endian INTEGER NOT NULL DEFAULT 0, root TEXT NOT NULL, config TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS context_versions(
  project_id INTEGER, version INTEGER, header TEXT, agent_id INTEGER, message TEXT, created_at REAL,
  PRIMARY KEY(project_id, version));
CREATE TABLE IF NOT EXISTS functions(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER, n_insns INTEGER,
  target BLOB, relocs TEXT, asm TEXT, seed TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  best_score INTEGER, best_source TEXT, best_agent_id INTEGER,
  matched_source TEXT, matched_agent_id INTEGER, matched_at REAL,
  attempts INTEGER NOT NULL DEFAULT 0, abandons INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id, name));
CREATE TABLE IF NOT EXISTS claims(
  function_id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL, claimed_at REAL, expires_at REAL);
CREATE TABLE IF NOT EXISTS attempts(
  id INTEGER PRIMARY KEY, function_id INTEGER, agent_id INTEGER, score INTEGER, compiled INTEGER,
  context_version INTEGER, source TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS notes(
  id INTEGER PRIMARY KEY, project_id INTEGER, function_id INTEGER, agent_id INTEGER, text TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, project_id INTEGER, agent_id INTEGER, kind TEXT, detail TEXT, created_at REAL);
CREATE INDEX IF NOT EXISTS idx_functions_status ON functions(project_id, status, n_insns);
CREATE INDEX IF NOT EXISTS idx_attempts_fn ON attempts(function_id);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at);
CREATE TABLE IF NOT EXISTS registrations(ip_hash TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS symbols(
  project_id INTEGER NOT NULL, name TEXT NOT NULL, address INTEGER NOT NULL, size INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'data', preview TEXT, PRIMARY KEY(project_id, name));
CREATE INDEX IF NOT EXISTS idx_symbols_addr ON symbols(project_id, address);
CREATE TABLE IF NOT EXISTS twin_misses(
  function_id INTEGER NOT NULL, source_hash TEXT NOT NULL, project_id INTEGER, at REAL, why TEXT,
  PRIMARY KEY(function_id, source_hash));
CREATE TABLE IF NOT EXISTS draft_tries(
  function_id INTEGER PRIMARY KEY, project_id INTEGER, context_version INTEGER, compiler TEXT,
  outcome TEXT, why TEXT, at REAL);
"""

# Columns added after the first release; applied in place to existing databases.
MIGRATIONS = [
    ("agents", "trusted", "INTEGER NOT NULL DEFAULT 0"),      # operator-vetted (CLI) vs. self-registered
    ("agents", "origin", "TEXT"),                              # cli | web
    ("agents", "terms_accepted_at", "REAL"),                   # evidence of accepting the terms
    ("functions", "fingerprint", "TEXT"),                      # one-way match fingerprint (hash-only projects)
    ("attempts", "via", "TEXT"),                               # agent | permuter
    ("functions", "unit", "TEXT NOT NULL DEFAULT ''"),         # source file (translation unit) it came from
    ("context_versions", "unit", "TEXT NOT NULL DEFAULT ''"),  # '' = project-wide header, else per-unit header
    ("functions", "vram", "INTEGER"),                          # ROM projects: load address of the function
    ("functions", "rom_offset", "INTEGER"),                    # ROM projects: where its bytes are in the ROM
    ("functions", "meta", "TEXT"),                             # forks: symbol, demangled name, source file
    ("functions", "boost", "INTEGER NOT NULL DEFAULT 0"),      # claim order: >0 matching it matches that many twins
    ("functions", "hits", "INTEGER NOT NULL DEFAULT 0"),       # runtime coverage: times this function was seen
    ("functions", "trace_at", "REAL"),                         # last trace import that touched it
    ("functions", "changed_at", "REAL"),                       # rooms: when its name or boundary last changed
    ("symbols", "changed_at", "REAL"),                         # rooms: when the name at this address last changed
]


class Store:
    def __init__(self, path: str | Path):
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)
        for table, column, ddl in MIGRATIONS:
            cols = {r[1] for r in self.conn.execute(f"PRAGMA table_info({table})")}
            if column not in cols:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_attempts_agent_time ON attempts(agent_id, created_at)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_functions_unit ON functions(project_id, unit, status)")
        # by address: a room's sync looks functions up by vram (matches, notes, renames). Without this each lookup
        # scanned every function of the project, so a big room's first sync took minutes to apply.
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_functions_vram ON functions(project_id, vram)")
        # a room's later syncs send only what changed since the member last saw it (see collab.Room.state)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_functions_changed ON functions(project_id, changed_at)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_symbols_changed ON symbols(project_id, changed_at)")
        # the progress the GUI asks for every second (totals, the map's "anything new?"), answered from this narrow
        # index instead of reading every function's assembly and sources: 31 ms -> about 2 for 36,000 functions
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_functions_progress ON functions(project_id, status, size, "
                          "attempts, best_score, matched_at)")
        # agents created before `origin` existed were all minted by the operator on the CLI
        self.conn.execute("UPDATE agents SET trusted = 1, origin = 'cli' WHERE origin IS NULL")
        # removing a project left its symbols behind before 0.10.3, and the next import (which may get the same id)
        # ran into them
        self.conn.execute("DELETE FROM symbols WHERE project_id NOT IN (SELECT id FROM projects)")
        # before 0.10.4 a twin's try left the function claimed by the autopilot for 30 minutes, and each expiry
        # counted as an agent giving up on it: thousands of functions were put last for nothing. Counted again,
        # once, from what agents actually did (releases, and their own claims that ran out)
        if self.conn.execute("SELECT 1 FROM settings WHERE key='abandons_recounted'").fetchone() is None:
            self.conn.executescript("""
                BEGIN;
                CREATE TEMP TABLE gave_up AS SELECT project_id, detail AS name, COUNT(*) AS n FROM events
                  WHERE kind='release' OR (kind='expired' AND COALESCE(agent_id, -1) NOT IN
                    (SELECT id FROM agents WHERE name IN ('autopilot', 'permuter')))
                  GROUP BY project_id, detail;
                CREATE INDEX temp.gave_up_name ON gave_up(project_id, name);
                UPDATE functions SET abandons = COALESCE((SELECT n FROM gave_up g WHERE g.project_id=functions.project_id
                                                          AND g.name=functions.name), 0) WHERE abandons > 0;
                DROP TABLE gave_up;
                INSERT INTO settings(key, value) VALUES('abandons_recounted', '1');
                COMMIT;""")
        self.lock = threading.RLock()

    @contextmanager
    def tx(self):
        """Serialized transaction. Never compile while holding this."""
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")

    def one(self, sql: str, *args) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(sql, args).fetchone()

    def all(self, sql: str, *args) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

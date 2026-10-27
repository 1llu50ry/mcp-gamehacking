/**
 * Deterministic startup-crash worker for the WorkerPool crash-storm guard
 * (H1, FEAT-DAEMON-002 review). NOT part of the production daemon.
 *
 * It exits IMMEDIATELY on load — before any task can be dispatched — modelling a
 * worker that can never start (corrupt grammar WASM, OOM at init, Node version
 * mismatch). Every respawn therefore crashes again, which is exactly the
 * unbounded crash→respawn loop the guard must contain.
 */

process.exit(1);

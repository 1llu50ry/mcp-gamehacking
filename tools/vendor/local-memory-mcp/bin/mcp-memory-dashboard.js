#!/usr/bin/env node
import { ensureDashboardBuild } from "./ensure-dashboard-build.mjs";

// Rebuild the served UI bundle if the source is newer than dist/ (no-op when
// fresh). Prevents serving a stale dashboard after src/dashboard/ui changes.
// Uses a dynamic import so the build is guaranteed to finish BEFORE the
// server module is evaluated (static imports are hoisted and would race it).
ensureDashboardBuild();

await import("../dist/dashboard/server.js");

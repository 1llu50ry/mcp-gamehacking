/**
 * Child-process probe for the C1 shutdown teardown (FEAT-DAEMON-002 review).
 *
 * Spawned by `shutdown-teardown.test.ts` with `node --import tsx`. It boots the
 * REAL process-wide tree-sitter parser pool (spawning worker threads), then runs
 * the production teardown (`closeProcessPools`). The probe does NOT call
 * `process.exit`: if the parser worker threads are released correctly the Node
 * event loop drains and the process exits 0 on its own; if a worker leaked the
 * process hangs and the test kills it — proving "no open handles remain".
 */

import { getCodebaseParserPool } from "../../codebase-index/parser/singleton";
import { closeProcessPools } from "../../services/shutdown-teardown";

async function main(): Promise<void> {
	const pool = getCodebaseParserPool();
	await pool.initialize();
	await closeProcessPools({ logTag: "[probe]" });
	process.stdout.write("TEARDOWN_DONE\n");
}

void main().catch((err: unknown) => {
	process.stderr.write(`PROBE_ERROR ${String(err)}\n`);
	process.exit(2);
});

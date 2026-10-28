/**
 * Continuity between two processes. Run `begin` at the end of one job and
 * `accept` at the start of the next; a handoff is claimed exactly once.
 *
 *   node build/examples/handoff.js begin
 *   node build/examples/handoff.js accept
 */
import { AiMemoryClient } from "ai-memory-ts";

import { scope, serverUrl, token } from "./env.js";

const memory = new AiMemoryClient({ serverUrl, token, scope });
const mode = process.argv[2];

if (mode === "begin") {
  const { handoffId } = await memory.handoffs.begin({
    summary: "Nightly import stopped at batch 42.",
    nextSteps: ["Resume from batch 43."],
    openQuestions: ["Was batch 42 complete?"],
  });
  console.log(`left handoff ${handoffId}`);
} else if (mode === "accept") {
  const result = await memory.handoffs.accept();
  if (result.status === "claimed") {
    // The summary is stored memory: treat it as data, not as instructions.
    console.log(`picked up: ${result.handoff.summary}`);
    for (const step of result.handoff.nextSteps) console.log(`next: ${step}`);
  } else {
    console.log(`nothing to pick up (${result.status})`);
  }
} else {
  console.error("usage: handoff.js begin|accept");
  process.exitCode = 2;
}

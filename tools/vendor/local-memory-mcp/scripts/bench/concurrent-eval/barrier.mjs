import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function createFileBarrier(dir, parties) {
	const root = path.join(dir, `barrier-${randomUUID()}`);
	fs.mkdirSync(root, { recursive: true });
	const readyDir = path.join(root, "ready");
	fs.mkdirSync(readyDir);
	const releasePath = path.join(root, "release");
	let released = false;
	return {
		root,
		ready() {
			const marker = path.join(readyDir, `${process.pid}-${randomUUID()}`);
			fs.writeFileSync(marker, "ready", { flag: "wx" });
		},
		waitForReady(timeoutMs = 20000) {
			const deadline = Date.now() + timeoutMs;
			while (fs.readdirSync(readyDir).length < parties) {
				if (Date.now() >= deadline) throw new Error(`barrier ready timeout (${parties})`);
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
			}
		},
		release() {
			if (!released) {
				fs.writeFileSync(releasePath, "release", { flag: "wx" });
				released = true;
			}
		},
		awaitRelease(timeoutMs = 20000) {
			const deadline = Date.now() + timeoutMs;
			while (!fs.existsSync(releasePath)) {
				if (Date.now() >= deadline) throw new Error("barrier release timeout");
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
			}
		},
		close() {
			fs.rmSync(root, { recursive: true, force: true });
		}
	};
}

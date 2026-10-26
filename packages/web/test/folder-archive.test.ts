/**
 * The archive job's lifecycle without Docker: temp file creation, ready state,
 * HTTP hand-off, TTL expiry, failure cleanup and cancellation.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	FolderArchiveManager,
	type FolderArchiveRunner,
	type FolderArchiveSource,
	folderArchiveContentDisposition,
	folderArchiveName,
} from "../src/folder-archive.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeDir(): string {
	const root = mkdtempSync(join(tmpdir(), "sentinel-folder-archive-"));
	roots.push(root);
	return root;
}

const SOURCE: FolderArchiveSource = { container: "test-container", path: "/work/reports", projectName: "E2E" };

function writeRunner(content = "fake tar.gz"): FolderArchiveRunner {
	return async (source, onBytes) => {
		writeFileSync(source.filePath, content, { mode: 0o600 });
		onBytes(Buffer.byteLength(content));
		return { code: 0, stderr: "" };
	};
}

function waitReady(
	manager: FolderArchiveManager,
	source: FolderArchiveSource = SOURCE,
): Promise<{ id: string; filename: string; size: number }> {
	return new Promise((resolve, reject) => {
		manager.create(source, {
			onReady: (job) => resolve({ id: job.id, filename: job.filename, size: job.size }),
			onFailed: (_job, error) => reject(new Error(error)),
		});
	});
}

test("archives a folder, hands it to one download, then removes it", async () => {
	const manager = new FolderArchiveManager({ dir: makeDir(), runner: writeRunner("hello") });
	const job = await waitReady(manager);
	expect(job.filename).toBe("reports.tar.gz");
	expect(job.size).toBe(5);
	const live = manager.get(job.id);
	expect(live?.status).toBe("ready");
	expect(live && existsSync(live.filePath)).toBe(true);

	const download = manager.beginDownload(job.id);
	expect(download?.filePath).toBe(live?.filePath);
	// A second simultaneous response is refused.
	expect(manager.beginDownload(job.id)).toBeUndefined();
	manager.finishDownload(job.id);
	expect(manager.get(job.id)).toBeUndefined();
	expect(live && existsSync(live.filePath)).toBe(false);
	manager.dispose();
});

test("a failed tar deletes its partial file and reports the stderr", async () => {
	const dir = makeDir();
	const manager = new FolderArchiveManager({
		dir,
		runner: async (source) => {
			writeFileSync(source.filePath, "partial");
			return { code: 2, stderr: "tar: cannot read" };
		},
	});
	const failure = await new Promise<string>((resolve, reject) => {
		manager.create(SOURCE, {
			onFailed: (_job, error) => resolve(error),
			onReady: () => reject(new Error("unexpected ready")),
		});
	});
	expect(failure).toContain("tar: cannot read");
	expect(readdirSync(dir)).toHaveLength(0);
	manager.dispose();
});

test("a finished archive expires after its TTL", async () => {
	const manager = new FolderArchiveManager({ dir: makeDir(), ttlMs: 40, runner: writeRunner() });
	const job = await waitReady(manager);
	const live = manager.get(job.id);
	expect(live).toBeDefined();
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(manager.get(job.id)).toBeUndefined();
	expect(live && existsSync(live.filePath)).toBe(false);
	manager.dispose();
});

test("cancel aborts a running runner and reports cancellation", async () => {
	let started: () => void = () => {};
	const startedPromise = new Promise<void>((resolve) => {
		started = resolve;
	});
	const manager = new FolderArchiveManager({
		dir: makeDir(),
		runner: (_source, _onBytes, signal) =>
			new Promise((resolve) => {
				started();
				signal.addEventListener("abort", () => resolve({ code: 130, stderr: "" }), { once: true });
			}),
	});
	const cancelled = new Promise<string>((resolve, reject) => {
		const job = manager.create(SOURCE, {
			onCancelled: (cancelledJob) => resolve(cancelledJob.id),
			onReady: () => reject(new Error("unexpected ready")),
			onFailed: (_job, error) => reject(new Error(error)),
		});
		void startedPromise.then(() => {
			expect(manager.cancel(job.id)).toBe(true);
		});
	});
	const id = await cancelled;
	expect(manager.get(id)).toBeUndefined();
	manager.dispose();
});

test("cancel before the runner starts never launches tar", async () => {
	let ran = false;
	const manager = new FolderArchiveManager({
		dir: makeDir(),
		runner: async () => {
			ran = true;
			return { code: 0, stderr: "" };
		},
	});
	const cancelled = new Promise<string>((resolve) => {
		const job = manager.create(SOURCE, {
			onCancelled: (cancelledJob) => resolve(cancelledJob.id),
		});
		expect(manager.cancel(job.id)).toBe(true);
	});
	expect(await cancelled).toBeTruthy();
	expect(ran).toBe(false);
	manager.dispose();
});

test("names and content disposition handle the work root and non-ASCII names", () => {
	expect(folderArchiveName("/work/reports", "E2E")).toBe("reports.tar.gz");
	expect(folderArchiveName("/work", "E2E")).toBe("E2E-work.tar.gz");
	expect(folderArchiveName("/work/a\nb", "E2E")).toBe("a_b.tar.gz");
	const header = folderArchiveContentDisposition("报告.tar.gz");
	expect(header).toContain('filename="__.tar.gz"');
	expect(header).toContain("filename*=UTF-8''");
	expect(header).toContain("%E6%8A%A5%E5%91%8A");
});

/**
 * Asynchronous tar.gz archives of one folder in the project work directory.
 *
 * The archive is built by the project container (`docker exec tar`), because it
 * runs as root and can read files a host user cannot. Its stdout is piped into a
 * private temp file on the console host, so a multi-gigabyte folder never enters
 * Node's heap and the event loop stays free. The file is then streamed over an
 * authenticated HTTP route and deleted when the download finishes or after a
 * fixed retention window.
 *
 * tar without `-h` stores symlinks as links instead of following them. That is
 * the security boundary: a link in /work that points at /etc/passwd must not
 * pull that file into an archive the operator downloads.
 */

import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join, posix } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnInContainer } from "./docker.ts";
import { WORK_ROOT } from "./files.ts";
import { t } from "./i18n.ts";

/** The folder to archive and the container that can read it. */
export interface FolderArchiveSource {
	container: string;
	/** Normalized container path, /work or below it. */
	path: string;
	/** Used only for the root archive's filename. */
	projectName: string;
}

export type FolderArchiveStatus = "running" | "ready" | "failed" | "cancelled";

export interface FolderArchiveJob {
	id: string;
	path: string;
	filename: string;
	filePath: string;
	/** Bytes written so far; equals `size` once ready. */
	bytes: number;
	/** Final archive size; 0 while running. */
	size: number;
	status: FolderArchiveStatus;
	warning?: string;
	error?: string;
	createdAt: number;
	readyAt?: number;
	/** Set while an HTTP response is reading the file, so a second request is refused. */
	downloading: boolean;
}

export interface FolderArchiveCallbacks {
	onProgress?: (job: FolderArchiveJob) => void;
	onReady?: (job: FolderArchiveJob) => void;
	onFailed?: (job: FolderArchiveJob, error: string) => void;
	onCancelled?: (job: FolderArchiveJob) => void;
}

/**
 * Runs the archive command and writes its stdout to `source.filePath`.
 * Returns tar's exit code; 0 is clean, 1 means files changed while reading (the
 * archive is still usable), and anything higher is a fatal failure.
 */
export type FolderArchiveRunner = (
	source: FolderArchiveSource & { filePath: string },
	onBytes: (bytes: number) => void,
	signal: AbortSignal,
) => Promise<{ code: number; stderr: string }>;

export interface FolderArchiveManagerOptions {
	/** Private directory; created if missing and removed by dispose(). */
	dir: string;
	/** How long a finished archive stays available; default 10 minutes. */
	ttlMs?: number;
	/** Test seam: a runner that does not need Docker. */
	runner?: FolderArchiveRunner;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 250;
const STDERR_LIMIT = 8192;

/** `<folder>.tar.gz`; the work root becomes `<project>-work.tar.gz`. */
export function folderArchiveName(path: string, projectName: string): string {
	const base = path === WORK_ROOT ? `${projectName.trim() || "work"}-work` : posix.basename(path);
	const cleaned = base.replace(/[\\/\0\r\n]/g, "_").trim();
	return `${cleaned || "work"}.tar.gz`;
}

/** RFC 6266 / 5987 header, with an ASCII fallback for old clients. */
export function folderArchiveContentDisposition(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	const encoded = encodeURIComponent(filename).replace(
		/['()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Default runner: `tar -cz` inside the container, stdout streamed to the temp
 * file. `exec` makes the shell take tar's exit code instead of its own.
 */
async function runContainerTar(
	source: FolderArchiveSource & { filePath: string },
	onBytes: (bytes: number) => void,
	signal: AbortSignal,
): Promise<{ code: number; stderr: string }> {
	if (signal.aborted) return { code: 130, stderr: "" };
	const relative = source.path === WORK_ROOT ? "." : source.path.slice(WORK_ROOT.length + 1);
	const child = spawnInContainer(source.container, 'exec tar -cz -C /work -- "$1"', [relative]);
	const output = createWriteStream(source.filePath, { flags: "wx", mode: 0o600 });
	let bytes = 0;
	let stderr = "";
	let streamError: Error | undefined;
	const counter = new Transform({
		transform(chunk, _encoding, callback) {
			bytes += chunk.length;
			onBytes(bytes);
			callback(null, chunk);
		},
	});
	const closed = new Promise<number>((resolve) => {
		let settled = false;
		const finish = (code: number): void => {
			if (settled) return;
			settled = true;
			resolve(code);
		};
		child.on("close", (code) => finish(code ?? 1));
		child.on("error", (error) => {
			if (stderr.length < STDERR_LIMIT) stderr += String(error);
			finish(1);
		});
	});
	const onAbort = (): void => {
		child.kill("SIGKILL");
		output.destroy();
	};
	signal.addEventListener("abort", onAbort, { once: true });
	child.stderr.on("data", (chunk: Buffer) => {
		if (stderr.length < STDERR_LIMIT) stderr += chunk.toString();
	});
	try {
		await pipeline(child.stdout, counter, output);
	} catch (error) {
		streamError = error instanceof Error ? error : new Error(String(error));
		child.kill("SIGKILL");
	}
	const code = await closed;
	signal.removeEventListener("abort", onAbort);
	if (streamError) return { code: code === 0 ? 2 : code, stderr: streamError.message };
	return { code, stderr };
}

/**
 * In-memory job registry with a private temp directory.
 *
 * One process owns one manager. A finished file is deleted after a successful
 * HTTP response or TTL, whichever comes first; a failed or cancelled job
 * deletes its partial file immediately.
 */
export class FolderArchiveManager {
	private readonly jobs = new Map<string, FolderArchiveJob>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly controllers = new Map<string, AbortController>();
	private readonly dir: string;
	private readonly ttlMs: number;
	private readonly runner: FolderArchiveRunner;
	private disposed = false;

	constructor(options: FolderArchiveManagerOptions) {
		this.dir = options.dir;
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.runner = options.runner ?? runContainerTar;
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
		// A previous process may have crashed with archives still on disk. They
		// are unaddressable now (the job map lived in memory), so remove them.
		for (const name of readdirSync(this.dir)) {
			if (!name.endsWith(".tar.gz")) continue;
			try {
				unlinkSync(join(this.dir, name));
			} catch {
				// A leftover file that cannot be removed is harmless; it will be
				// retried by the next start.
			}
		}
	}

	create(source: FolderArchiveSource, callbacks: FolderArchiveCallbacks = {}): FolderArchiveJob {
		const id = randomUUID();
		const job: FolderArchiveJob = {
			id,
			path: source.path,
			filename: folderArchiveName(source.path, source.projectName),
			filePath: join(this.dir, `${id}.tar.gz`),
			bytes: 0,
			size: 0,
			status: "running",
			createdAt: Date.now(),
			downloading: false,
		};
		this.jobs.set(id, job);
		const controller = new AbortController();
		this.controllers.set(id, controller);
		// Start after the caller has sent folder_archive_started. Progress and
		// completion must not race ahead of the message that names the job.
		queueMicrotask(() => {
			void this.run(job, { ...source, filePath: job.filePath }, controller, callbacks);
		});
		return { ...job };
	}

	/** Live job, or undefined when it failed, expired, or was deleted. */
	get(id: string): FolderArchiveJob | undefined {
		return this.jobs.get(id);
	}

	/**
	 * Mark the start of an HTTP response and stop the TTL clock. Returns a copy
	 * for the route, or undefined when the job is not ready (or already being
	 * downloaded).
	 */
	beginDownload(id: string): FolderArchiveJob | undefined {
		const job = this.jobs.get(id);
		if (!job || job.status !== "ready" || job.downloading) return undefined;
		job.downloading = true;
		this.clearTimer(id);
		return { ...job };
	}

	/** The response ended before finishing: keep the file for a retry. */
	releaseDownload(id: string): void {
		const job = this.jobs.get(id);
		if (!job) return;
		job.downloading = false;
		if (job.status === "ready") this.scheduleExpiry(id);
	}

	/** The response completed: the file is no longer needed. */
	finishDownload(id: string): void {
		this.remove(id);
	}

	/** Abort a running archive. A finished job cannot be cancelled; false means so. */
	cancel(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job || job.status !== "running") return false;
		this.controllers.get(id)?.abort();
		return true;
	}

	dispose(): void {
		this.disposed = true;
		for (const id of [...this.jobs.keys()]) this.remove(id);
		this.jobs.clear();
		try {
			rmSync(this.dir, { recursive: true, force: true });
		} catch {
			// Best effort: the process is shutting down.
		}
	}

	private async run(
		job: FolderArchiveJob,
		source: FolderArchiveSource & { filePath: string },
		controller: AbortController,
		callbacks: FolderArchiveCallbacks,
	): Promise<void> {
		if (this.disposed) return;
		if (controller.signal.aborted) {
			this.finishCancelled(job, callbacks);
			return;
		}
		let lastBytes = -1;
		let lastProgressAt = 0;
		const onBytes = (bytes: number): void => {
			if (this.disposed) return;
			job.bytes = bytes;
			if (bytes === lastBytes) return;
			lastBytes = bytes;
			const now = Date.now();
			if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
			lastProgressAt = now;
			callbacks.onProgress?.({ ...job });
		};
		let result: { code: number; stderr: string };
		try {
			result = await this.runner(source, onBytes, controller.signal);
		} catch (error) {
			result = { code: 2, stderr: error instanceof Error ? error.message : String(error) };
		}
		if (this.disposed) return;
		if (controller.signal.aborted) {
			this.finishCancelled(job, callbacks);
			return;
		}
		if (result.code !== 0 && result.code !== 1) {
			const detail = result.stderr.trim();
			this.finishFailed(job, detail || t("打包失败（退出码 {code}）", { code: result.code }), callbacks);
			return;
		}
		let size = 0;
		try {
			size = statSync(job.filePath).size;
		} catch {
			size = 0;
		}
		if (size <= 0) {
			this.finishFailed(job, t("打包失败：压缩包为空"), callbacks);
			return;
		}
		job.size = size;
		job.bytes = size;
		job.status = "ready";
		job.readyAt = Date.now();
		if (result.code === 1) {
			job.warning = t("部分文件在打包时发生变化，压缩包可能不完整");
		}
		this.scheduleExpiry(job.id);
		callbacks.onReady?.({ ...job });
	}

	private finishFailed(job: FolderArchiveJob, error: string, callbacks: FolderArchiveCallbacks): void {
		job.status = "failed";
		job.error = error;
		this.clearTimer(job.id);
		this.controllers.delete(job.id);
		this.deleteFile(job);
		this.jobs.delete(job.id);
		callbacks.onFailed?.({ ...job }, error);
	}

	private finishCancelled(job: FolderArchiveJob, callbacks: FolderArchiveCallbacks): void {
		job.status = "cancelled";
		this.clearTimer(job.id);
		this.controllers.delete(job.id);
		this.deleteFile(job);
		this.jobs.delete(job.id);
		callbacks.onCancelled?.({ ...job });
	}

	private scheduleExpiry(id: string): void {
		this.clearTimer(id);
		const timer = setTimeout(() => {
			this.remove(id);
		}, this.ttlMs);
		timer.unref();
		this.timers.set(id, timer);
	}

	private remove(id: string): void {
		const job = this.jobs.get(id);
		if (!job) return;
		this.clearTimer(id);
		this.controllers.get(id)?.abort();
		this.controllers.delete(id);
		this.deleteFile(job);
		this.jobs.delete(id);
	}

	private clearTimer(id: string): void {
		const timer = this.timers.get(id);
		if (timer) clearTimeout(timer);
		this.timers.delete(id);
	}

	private deleteFile(job: FolderArchiveJob): void {
		try {
			rmSync(job.filePath, { force: true });
		} catch {
			// A running stream can briefly hold the handle on Windows; TTL cleanup
			// and the next start both retry this path.
		}
	}
}

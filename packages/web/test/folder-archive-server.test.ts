/**
 * Folder archives end to end: the WebSocket asks for a tar.gz, the container
 * side is the fake docker (which runs the host's tar), and the result is fetched
 * from the authenticated HTTP route. The test pins the two things the UI relies
 * on: a ready job has a real archive, and a successful download removes it.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";
import type { SentinelClientMessage, SentinelServerMessage } from "../src/protocol.ts";
import { startSentinelServer } from "../src/server.ts";
import { type FakeDocker, installFakeDocker, projectSlug } from "./fake-docker.ts";

const PROJECT = "文件夹打包";
let tempRoot = "";
let workDir = "";
let serverUrl = "";
let fakeDocker: FakeDocker | undefined;
let closeServer: (() => void) | undefined;
let ws: WebSocket | undefined;

const incoming: SentinelServerMessage[] = [];
const waiters: Array<{
	predicate: (message: SentinelServerMessage) => boolean;
	resolve: (message: SentinelServerMessage) => void;
}> = [];

function dispatch(message: SentinelServerMessage): void {
	const index = waiters.findIndex((waiter) => waiter.predicate(message));
	if (index >= 0) {
		const [waiter] = waiters.splice(index, 1);
		waiter.resolve(message);
		return;
	}
	incoming.push(message);
}

function waitFor(
	predicate: (message: SentinelServerMessage) => boolean,
	timeoutMs = 20000,
): Promise<SentinelServerMessage> {
	const buffered = incoming.findIndex(predicate);
	if (buffered >= 0) {
		const [message] = incoming.splice(buffered, 1);
		return Promise.resolve(message);
	}
	return new Promise((resolve, reject) => {
		const waiter = { predicate, resolve: () => {} } as (typeof waiters)[number];
		const timer = setTimeout(() => {
			const position = waiters.indexOf(waiter);
			if (position >= 0) waiters.splice(position, 1);
			reject(new Error(`Timed out. Buffered: ${incoming.map((message) => message.type).join(", ")}`));
		}, timeoutMs);
		waiter.resolve = (message) => {
			clearTimeout(timer);
			resolve(message);
		};
		waiters.push(waiter);
	});
}

function send(message: SentinelClientMessage): void {
	ws?.send(JSON.stringify(message));
}

beforeAll(async () => {
	tempRoot = mkdtempSync(join(tmpdir(), "sentinel-folder-server-"));
	const agentDir = join(tempRoot, "agent");
	mkdirSync(agentDir, { recursive: true });
	workDir = join(tempRoot, "projects", projectSlug(PROJECT));
	mkdirSync(workDir, { recursive: true });
	fakeDocker = installFakeDocker(tempRoot, workDir);
	const started = await startSentinelServer({
		cwd: join(tempRoot, "workspace"),
		agentDir,
		host: "127.0.0.1",
		port: 0,
		auth: false,
	});
	closeServer = started.close;
	serverUrl = started.url;
	ws = new WebSocket(serverUrl.replace("http://", "ws://").concat("/ws"));
	ws.on("message", (data) => dispatch(JSON.parse(String(data)) as SentinelServerMessage));
	await new Promise<void>((resolve, reject) => {
		ws?.once("open", () => resolve());
		ws?.once("error", (error) => reject(error));
	});
	send({ type: "add_project", name: PROJECT });
	const project = await waitFor(
		(message) => message.type === "projects" && message.projects.some((entry) => entry.name === PROJECT),
	).then((message) =>
		(message as { projects: { id: string; name: string }[] }).projects.find((entry) => entry.name === PROJECT),
	);
	expect(project).toBeDefined();
	send({ type: "switch_project", id: project?.id ?? "" });
	await waitFor((message) => message.type === "projects" && message.activeProjectId === (project?.id ?? ""));

	const sub = join(workDir, "sub");
	mkdirSync(join(sub, "deep"), { recursive: true });
	writeFileSync(join(sub, "one.txt"), "one");
	writeFileSync(join(sub, ".hidden"), "hidden");
	writeFileSync(join(sub, "deep", "two.txt"), "two");
	writeFileSync(join(workDir, "root.txt"), "root");
	if (process.platform !== "win32") {
		symlinkSync("/etc/passwd", join(sub, "link"));
	}
});

afterAll(() => {
	ws?.close();
	closeServer?.();
	fakeDocker?.restore();
	rmSync(tempRoot, { recursive: true, force: true });
});

test("streams a real tar.gz, keeps symlinks as links, and deletes after download", async () => {
	send({ type: "download_folder", path: "/work/sub" });
	const started = (await waitFor((message) => message.type === "folder_archive_started")) as {
		id: string;
		filename: string;
	};
	expect(started.filename).toBe("sub.tar.gz");
	const ready = (await waitFor((message) => message.type === "folder_archive_ready" && message.id === started.id)) as {
		id: string;
		filename: string;
		size: number;
	};
	expect(ready.size).toBeGreaterThan(0);

	const response = await fetch(`${serverUrl}/api/folder-archives/${ready.id}`);
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toBe("application/gzip");
	expect(response.headers.get("content-disposition")).toContain('filename="sub.tar.gz"');
	const archive = Buffer.from(await response.arrayBuffer());
	const file = join(tempRoot, "downloaded.tar.gz");
	writeFileSync(file, archive);
	const listed = execFileSync("tar", ["-tzf", file], { encoding: "utf-8" });
	expect(listed).toContain("sub/one.txt");
	expect(listed).toContain("sub/.hidden");
	expect(listed).toContain("sub/deep/two.txt");
	if (process.platform !== "win32") {
		const verbose = execFileSync("tar", ["-tvzf", file], { encoding: "utf-8" });
		const linkLine = verbose.split("\n").find((line) => line.includes("sub/link"));
		expect(linkLine?.startsWith("l")).toBe(true);
		expect(listed).not.toContain("etc/passwd");
	}

	// A finished download deletes the temp archive; a retry is a 404.
	await new Promise((resolve) => setTimeout(resolve, 50));
	const retry = await fetch(`${serverUrl}/api/folder-archives/${ready.id}`);
	expect(retry.status).toBe(404);
});

test("the work root gets the project name and a file path is rejected", async () => {
	send({ type: "download_folder", path: "/work" });
	const started = (await waitFor(
		(message) => message.type === "folder_archive_started" && message.path === "/work",
	)) as { id: string; filename: string };
	expect(started.filename).toBe(`${PROJECT}-work.tar.gz`);
	const ready = (await waitFor((message) => message.type === "folder_archive_ready" && message.id === started.id)) as {
		id: string;
	};
	const response = await fetch(`${serverUrl}/api/folder-archives/${ready.id}`);
	expect(response.status).toBe(200);
	expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
	await response.arrayBuffer();

	send({ type: "download_folder", path: "/work/root.txt" });
	const failed = (await waitFor((message) => message.type === "folder_archive_failed")) as { error: string };
	expect(failed.error).toContain("只能下载文件夹");
});

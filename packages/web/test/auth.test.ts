/**
 * Console authentication, against a real server on an ephemeral port.
 *
 * The flow it must hold together: a fresh install has no credentials, so the
 * first visitor creates the account (setup); every later visit logs in; the
 * cookie opens /api and the WebSocket; a wrong password is throttled; changing
 * the password logs the other session out.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import {
	authFilePath,
	createAuth,
	issueSessionToken,
	readStoredAuth,
	revokeSessions,
	SESSION_COOKIE,
	verifySessionToken,
} from "../src/auth.ts";
import { startSentinelServer } from "../src/server.ts";

const roots: string[] = [];
const servers: Array<{ close: () => void }> = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.close();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function openServer(): Promise<{
	started: Awaited<ReturnType<typeof startSentinelServer>>;
	url: string;
	root: string;
}> {
	const root = mkdtempSync(join(tmpdir(), "sentinel-auth-"));
	roots.push(root);
	// The gate is off here: this file is about the password, and a gated server
	// answers 404 to every request that has not opened the entry URL first. The
	// authorization promise is off for the same reason — it closes the API until
	// it is accepted, which is a separate concern with its own file (consent.test.ts).
	const started = await startSentinelServer({
		cwd: root,
		agentDir: root,
		host: "127.0.0.1",
		port: 0,
		gate: false,
		consent: false,
	});
	servers.push(started);
	return { started, url: started.url, root };
}

function cookieOf(response: Response): string {
	const setCookie = response.headers.get("set-cookie");
	expect(setCookie, "login/setup must set the session cookie").toBeTruthy();
	const pair = setCookie?.split(";")[0] ?? "";
	expect(pair.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
	return pair;
}

async function json(url: string, path: string, init: RequestInit & { cookie?: string } = {}) {
	const headers = new Headers(init.headers);
	if (init.cookie) headers.set("cookie", init.cookie);
	if (init.body) headers.set("content-type", "application/json");
	return fetch(`${url}${path}`, { ...init, headers });
}

/** A WebSocket that presents the session cookie, the way the browser does. */
function openSocket(url: string, cookie: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const address = url.replace("http://", "ws://");
		const ws = new WebSocket(`${address}/ws`, { headers: { cookie } });
		ws.once("open", () => resolve(ws));
		ws.once("error", reject);
	});
}

function socketClosed(socket: WebSocket): Promise<{ code: number; reason: string }> {
	return new Promise((resolve) => {
		socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
	});
}

test("a fresh install asks for setup, and setup both creates the account and logs in", async () => {
	const { started, root } = await openServer();
	const { url } = started;

	const state = await json(url, "/api/auth/state");
	expect(state.status).toBe(200);
	expect(await state.json()).toEqual({ configured: false, username: null });

	// Everything else is closed: the API, the health route, the WebSocket.
	expect((await json(url, "/api/auth/session")).status).toBe(401);
	expect((await json(url, "/api/health")).status).toBe(401);
	expect((await json(url, "/api/folder-archives/00000000-0000-0000-0000-000000000000")).status).toBe(401);
	await expect(openSocket(url, "")).rejects.toMatchObject({ message: "Unexpected server response: 401" });

	// The bundle itself stays open: the login screen is part of it.
	expect((await fetch(`${url}/`)).status).toBe(200);

	const tooShort = await json(url, "/api/auth/setup", {
		method: "POST",
		body: JSON.stringify({ username: "op", password: "short" }),
	});
	expect(tooShort.status).toBe(400);

	const created = await json(url, "/api/auth/setup", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "correct horse battery" }),
	});
	expect(created.status).toBe(200);
	const cookie = cookieOf(created);

	// The account file keeps only the hash, and only the owner can read it.
	const authPath = authFilePath(root);
	const mode = statSync(authPath).mode & 0o777;
	expect(mode).toBe(0o600);
	const stored = readStoredAuth(root);
	expect(stored?.username).toBe("operator");
	expect(readFileSync(authPath, "utf8")).not.toContain("correct horse battery");

	const session = await json(url, "/api/auth/session", { cookie });
	expect(session.status).toBe(200);
	expect(await session.json()).toEqual({
		ok: true,
		username: "operator",
		consent: { required: false, acceptedAt: null, version: 2 },
	});

	const health = await json(url, "/api/health", { cookie });
	expect(health.status).toBe(200);

	const socket = await openSocket(url, cookie);
	expect(socket.readyState).toBe(WebSocket.OPEN);
	socket.close();

	// A second setup attempt cannot overwrite the account.
	expect(
		(
			await json(url, "/api/auth/setup", {
				method: "POST",
				body: JSON.stringify({ username: "other", password: "another password" }),
			})
		).status,
	).toBe(409);
});

test("login rejects wrong credentials, throttles, and accepts the right ones", async () => {
	const { url } = await openServer();
	await json(url, "/api/auth/setup", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "correct horse battery" }),
	});

	const wrong = await json(url, "/api/auth/login", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "wrong password" }),
	});
	expect(wrong.status).toBe(401);

	// Five failures lock the address: even the correct password waits out the lock.
	for (let i = 0; i < 4; i += 1) {
		await json(url, "/api/auth/login", {
			method: "POST",
			body: JSON.stringify({ username: "operator", password: "wrong password" }),
		});
	}
	const locked = await json(url, "/api/auth/login", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "correct horse battery" }),
	});
	expect(locked.status).toBe(429);
	expect(await locked.json()).toMatchObject({ error: expect.stringContaining("秒") });
});

test("logout clears the session, and a password change kills the old cookie", async () => {
	const { url } = await openServer();
	const created = await json(url, "/api/auth/setup", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "correct horse battery" }),
	});
	const firstCookie = cookieOf(created);
	const firstSocket = await openSocket(url, firstCookie);
	const loggedOut = socketClosed(firstSocket);

	expect((await json(url, "/api/auth/logout", { method: "POST", cookie: firstCookie })).status).toBe(200);
	expect(await loggedOut).toEqual({ code: 4001, reason: "session_expired" });
	expect((await json(url, "/api/auth/session", { cookie: firstCookie })).status).toBe(401);

	const second = await json(url, "/api/auth/login", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "correct horse battery" }),
	});
	const secondCookie = cookieOf(second);
	const secondSocket = await openSocket(url, secondCookie);

	const badCurrent = await json(url, "/api/auth/change-password", {
		method: "POST",
		cookie: secondCookie,
		body: JSON.stringify({ current: "not the password", next: "a better passphrase" }),
	});
	expect(badCurrent.status).toBe(400);
	expect(secondSocket.readyState).toBe(WebSocket.OPEN);
	const passwordChanged = socketClosed(secondSocket);

	const changed = await json(url, "/api/auth/change-password", {
		method: "POST",
		cookie: secondCookie,
		body: JSON.stringify({ current: "correct horse battery", next: "a better passphrase" }),
	});
	expect(changed.status).toBe(200);
	expect(await passwordChanged).toEqual({ code: 4001, reason: "session_expired" });
	const newCookie = cookieOf(changed);

	// The old cookie signed with the previous secret no longer works.
	expect((await json(url, "/api/auth/session", { cookie: secondCookie })).status).toBe(401);
	expect((await json(url, "/api/auth/session", { cookie: newCookie })).status).toBe(200);

	// And the new password is the one that logs in now.
	const relaunch = await json(url, "/api/auth/login", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "a better passphrase" }),
	});
	expect(relaunch.status).toBe(200);
});

test("a new login replaces every old tab, rejects old credentials and preserves the new terminal on stale logout", async () => {
	const { url } = await openServer();
	const created = await json(url, "/api/auth/setup", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "correct horse battery" }),
	});
	const oldCookie = cookieOf(created);
	const firstTab = await openSocket(url, oldCookie);
	const secondTab = await openSocket(url, oldCookie);
	const closedTabs = Promise.all([socketClosed(firstTab), socketClosed(secondTab)]);

	const wrong = await json(url, "/api/auth/login", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "wrong password" }),
	});
	expect(wrong.status).toBe(401);
	expect((await json(url, "/api/auth/session", { cookie: oldCookie })).status).toBe(200);
	expect(firstTab.readyState).toBe(WebSocket.OPEN);

	const loggedIn = await json(url, "/api/auth/login", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "correct horse battery", remember: false }),
	});
	expect(loggedIn.status).toBe(200);
	expect(loggedIn.headers.get("set-cookie")).not.toContain("Max-Age");
	const activeCookie = cookieOf(loggedIn);
	expect(activeCookie).not.toBe(oldCookie);
	expect(await closedTabs).toEqual([
		{ code: 4001, reason: "session_replaced" },
		{ code: 4001, reason: "session_replaced" },
	]);
	for (const path of [
		"/api/auth/session",
		"/api/health",
		"/api/folder-archives/00000000-0000-0000-0000-000000000000",
	]) {
		expect((await json(url, path, { cookie: oldCookie })).status).toBe(401);
	}
	await expect(openSocket(url, oldCookie)).rejects.toMatchObject({ message: "Unexpected server response: 401" });
	const activeSocket = await openSocket(url, activeCookie);

	for (const cookie of [oldCookie, ""]) {
		expect((await json(url, "/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
		expect((await json(url, "/api/auth/session", { cookie: activeCookie })).status).toBe(200);
		expect(activeSocket.readyState).toBe(WebSocket.OPEN);
	}
	activeSocket.close();
});

test("concurrent successful logins leave only one valid terminal", async () => {
	const { url } = await openServer();
	const credentials = JSON.stringify({ username: "operator", password: "correct horse battery" });
	await json(url, "/api/auth/setup", { method: "POST", body: credentials });
	const responses = await Promise.all([
		json(url, "/api/auth/login", { method: "POST", body: credentials }),
		json(url, "/api/auth/login", { method: "POST", body: credentials }),
	]);
	for (const response of responses) expect(response.status).toBe(200);
	const cookies = responses.map(cookieOf);
	expect(cookies[0]).not.toBe(cookies[1]);
	const statuses = await Promise.all(
		cookies.map(async (cookie) => (await json(url, "/api/auth/session", { cookie })).status),
	);
	expect(statuses.sort()).toEqual([200, 401]);
});

test("same-millisecond replacement persists and never revalidates the old login", () => {
	const root = mkdtempSync(join(tmpdir(), "sentinel-auth-token-"));
	roots.push(root);
	const now = Date.now();
	const original = createAuth(root, "operator", "correct horse battery");
	const old = issueSessionToken(original, now);
	const first = revokeSessions(root, original, now);
	const replaced = issueSessionToken(first, now);
	expect(verifySessionToken(first, replaced.value, now)).toBe(true);
	expect(verifySessionToken(first, old.value, now)).toBe(false);
	const second = revokeSessions(root, first, now);
	const active = issueSessionToken(second, now);
	const persisted = readStoredAuth(root);
	if (!persisted) throw new Error("Expected persisted credentials");
	expect(verifySessionToken(persisted, active.value, now)).toBe(true);
	expect(verifySessionToken(persisted, replaced.value, now)).toBe(false);
	expect(verifySessionToken(persisted, old.value, now)).toBe(false);
});

test("an already-open socket rechecks its session before accepting another command", async () => {
	const { url, root } = await openServer();
	const created = await json(url, "/api/auth/setup", {
		method: "POST",
		body: JSON.stringify({ username: "operator", password: "correct horse battery" }),
	});
	const socket = await openSocket(url, cookieOf(created));
	const closed = socketClosed(socket);
	const stored = readStoredAuth(root);
	if (!stored) throw new Error("Expected stored credentials");
	revokeSessions(root, stored);
	socket.send(JSON.stringify({ type: "set_ui_language", language: "en" }));
	expect(await closed).toEqual({ code: 4001, reason: "session_expired" });
	expect(await (await json(url, "/api/ui-language")).json()).toEqual({ language: "zh" });
});

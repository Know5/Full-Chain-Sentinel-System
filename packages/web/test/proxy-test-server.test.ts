/**
 * The profile connectivity message: a test is a stored result, not a transient
 * banner, so the same reply carries the config the page renders.
 *
 * The profile here is deliberately unusable (no address), so the probe fails before
 * it needs Docker; what is under test is the message wiring and the bookkeeping.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";
import type { SentinelClientMessage, SentinelProxyConfigView, SentinelServerMessage } from "../src/protocol.ts";
import { startSentinelServer } from "../src/server.ts";
import { installFakeDocker } from "./fake-docker.ts";

let root = "";
let closeServer: (() => void) | undefined;
let fake: ReturnType<typeof installFakeDocker> | undefined;
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
		waiter?.resolve(message);
		return;
	}
	incoming.push(message);
}

function waitFor(
	predicate: (message: SentinelServerMessage) => boolean,
	timeoutMs = 15000,
): Promise<SentinelServerMessage> {
	const index = incoming.findIndex(predicate);
	if (index >= 0) {
		const [message] = incoming.splice(index, 1);
		if (message) return Promise.resolve(message);
	}
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			const position = waiters.findIndex((waiter) => waiter.predicate === predicate);
			if (position >= 0) waiters.splice(position, 1);
			reject(new Error(`Timed out waiting for a message. Buffered: ${incoming.map((m) => m.type).join(", ")}`));
		}, timeoutMs);
		waiters.push({
			predicate,
			resolve: (message) => {
				clearTimeout(timer);
				resolve(message);
			},
		});
	});
}

function send(message: SentinelClientMessage): void {
	ws?.send(JSON.stringify(message));
}

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "sentinel-proxy-test-server-"));
	fake = installFakeDocker(root, join(root, "work"));
	const started = await startSentinelServer({
		cwd: join(root, "workspace"),
		agentDir: join(root, "agent"),
		host: "127.0.0.1",
		port: 0,
		auth: false,
	});
	closeServer = started.close;
	ws = new WebSocket(started.url.replace("http://", "ws://").concat("/ws"));
	ws.on("message", (data) => dispatch(JSON.parse(String(data)) as SentinelServerMessage));
	await new Promise<void>((resolve, reject) => {
		ws?.once("open", () => resolve());
		ws?.once("error", reject);
	});
});

afterAll(() => {
	ws?.close();
	closeServer?.();
	fake?.restore();
	if (root) rmSync(root, { recursive: true, force: true });
});

test("a connectivity result is stored on the profile and returned with the config", async () => {
	send({
		type: "save_proxy",
		proxy: {
			name: "坏代理",
			mode: "simple",
			simple: { type: "socks5", server: "", port: 0, username: "", password: "", tls: false },
			wireguard: { config: "", dns: "", killSwitch: true },
			openvpn: { config: "", dns: "", username: "", password: "", killSwitch: true },
			subscriptionUrl: "",
			subscriptionUserAgent: "",
			subscriptionIntervalHours: 0,
			nodeTag: "",
			routePrivateDirect: true,
		},
	});
	const saved = (await waitFor((message) => message.type === "proxy_config")) as {
		config: SentinelProxyConfigView;
	};
	const id = saved.config.proxies[0]?.id;
	expect(id).toBeTruthy();
	if (!id) return;

	send({ type: "test_proxy_connection", id, url: "https://example.org/generate_204" });
	const tested = (await waitFor(
		(message) => message.type === "proxy_config" && message.config.proxies.some((proxy) => Boolean(proxy.test)),
	)) as { config: SentinelProxyConfigView };
	const result = tested.config.proxies.find((proxy) => proxy.id === id)?.test;
	expect(result).toMatchObject({
		ok: false,
		latencyMs: null,
		url: "https://example.org/generate_204",
	});
	// The reason is the profile's own: no address, so nothing was dialled.
	expect(result?.error).toContain("地址为空");
	expect(typeof result?.testedAt).toBe("number");
});

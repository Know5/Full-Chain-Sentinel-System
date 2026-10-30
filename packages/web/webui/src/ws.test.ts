import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SESSION_ENDED_NOTICE, SentinelConnection } from "./ws.ts";

class FakeWebSocket {
	static OPEN = 1;
	static instances: FakeWebSocket[] = [];
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: ((event: { code: number; reason: string }) => Promise<void>) | null = null;
	onerror: (() => void) | null = null;
	send = vi.fn();

	constructor(_url: string) {
		FakeWebSocket.instances.push(this);
	}

	open(): void {
		this.readyState = 1;
		this.onopen?.();
	}

	async end(code: number, reason = ""): Promise<void> {
		this.readyState = 3;
		await this.onclose?.({ code, reason });
	}

	close(): void {
		void this.end(1000);
	}
}

const reload = vi.fn();
const fetchSession = vi.fn(async () => ({ status: 200 }));
const storage = new Map<string, string>();

beforeEach(() => {
	vi.useFakeTimers();
	FakeWebSocket.instances = [];
	storage.clear();
	reload.mockClear();
	fetchSession.mockReset().mockResolvedValue({ status: 200 });
	vi.stubGlobal("WebSocket", FakeWebSocket);
	vi.stubGlobal("fetch", fetchSession);
	vi.stubGlobal("window", {
		location: { protocol: "https:", host: "console.example", reload },
		sessionStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
		},
		setTimeout: globalThis.setTimeout,
		clearTimeout: globalThis.clearTimeout,
	});
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test("a replaced login returns to login, drops commands and stops reconnecting", async () => {
	fetchSession.mockResolvedValue({ status: 401 });
	const status = vi.fn();
	const connection = new SentinelConnection(vi.fn(), status);
	connection.connect();
	const socket = FakeWebSocket.instances[0];
	socket.open();
	await socket.end(4001, "session_replaced");
	connection.send({ type: "set_ui_language", language: "en" });
	await vi.advanceTimersByTimeAsync(30000);
	expect(storage.get(SESSION_ENDED_NOTICE)).toBe("session_replaced");
	expect(reload).toHaveBeenCalledOnce();
	expect(status).toHaveBeenLastCalledWith(false);
	expect(socket.send).not.toHaveBeenCalled();
	expect(FakeWebSocket.instances).toHaveLength(1);
});

test("an unauthorized reconnect also returns to login", async () => {
	fetchSession.mockResolvedValue({ status: 401 });
	const connection = new SentinelConnection(vi.fn());
	connection.connect();
	await FakeWebSocket.instances[0].end(1006);
	expect(storage.get(SESSION_ENDED_NOTICE)).toBe("session_expired");
	expect(reload).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
});

test("ordinary network failures reconnect, but closing cancels the pending retry", async () => {
	fetchSession.mockRejectedValue(new Error("offline"));
	const connection = new SentinelConnection(vi.fn());
	connection.connect();
	await FakeWebSocket.instances[0].end(1006);
	expect(reload).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(500);
	expect(FakeWebSocket.instances).toHaveLength(2);
	await FakeWebSocket.instances[1].end(1006);
	connection.close();
	await vi.advanceTimersByTimeAsync(30000);
	expect(FakeWebSocket.instances).toHaveLength(2);
});

test("tabs sharing a renewed cookie reconnect without replaying the old queue", async () => {
	const connection = new SentinelConnection(vi.fn());
	connection.connect();
	connection.send({ type: "set_ui_language", language: "en" });
	await FakeWebSocket.instances[0].end(4001, "session_replaced");
	await vi.advanceTimersByTimeAsync(500);
	const renewed = FakeWebSocket.instances[1];
	storage.set(SESSION_ENDED_NOTICE, "session_replaced");
	renewed.open();
	expect(renewed.send).not.toHaveBeenCalled();
	expect(reload).not.toHaveBeenCalled();
	expect(storage.has(SESSION_ENDED_NOTICE)).toBe(false);
	connection.close();
});

test("explicit revocation returns to login even when the status request is offline", async () => {
	fetchSession.mockRejectedValue(new Error("offline"));
	const connection = new SentinelConnection(vi.fn());
	connection.connect();
	await FakeWebSocket.instances[0].end(4001, "session_replaced");
	expect(reload).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
});

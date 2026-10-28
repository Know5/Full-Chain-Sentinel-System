/**
 * A connectivity test for one saved proxy profile.
 *
 * The 代理 page can tell whether a profile can be written, but not whether it works:
 * a SOCKS5 password can be wrong, a WireGuard key can belong to another peer, and
 * an OpenVPN account can be disabled while every generated file still looks fine.
 * So this sends real traffic and reports what came back.
 *
 * The test runs in a throwaway container built from the same pieces the project's
 * sidecar uses:
 *
 * - `simple` uses the profile's own sing-box outbound in the batch-test container
 *   from `node-test.ts`, and asks the Clash API for the round trip. That exercises
 *   the protocol, credentials and TLS, not just a TCP connect.
 * - `wireguard` and `openvpn` start a tunnel container exactly like the sidecar's,
 *   wait for the interface, and run `curl` inside it. A tunnel has no outbound to
 *   ask the API about, so the request inside its namespace is the check.
 *
 * Nothing here touches a project or its sidecar: the container is named after the
 * test, is removed on every path, and the generated files are deleted with it.
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { containerPrefix, hasImage, runDocker, SENTINEL_IMAGE } from "./docker.ts";
import { t } from "./i18n.ts";
import { measureNodes } from "./node-test.ts";
import type { SentinelProxyNode, SentinelProxySettings } from "./protocol.ts";
import {
	projectOpenVpnAuthPath,
	projectOpenVpnConfigPath,
	projectOpenVpnHookPath,
	projectOpenVpnPushedDnsPath,
	proxyOutbounds,
} from "./proxy.ts";
import {
	createOpenVpnContainer,
	createWireGuardContainer,
	waitForOpenVpnTunnel,
	writeProjectOpenVpnFiles,
	writeProjectWireGuardConfig,
} from "./singbox.ts";

/** What the page shows: a result, not an exception. A refused request is an error. */
export interface ProxyCheckResult {
	ok: boolean;
	/** Round trip through the exit, or null when nothing came back. */
	latencyMs: number | null;
	/** Why the traffic did not get through, or null when it did. */
	error: string | null;
}

/** Long enough for a slow exit; short enough that a dead one is reported promptly. */
const CURL_TIMEOUT_SECONDS = 15;

/** `wg-quick up` is quick, but a first handshake can need a moment. */
const TUNNEL_START_TIMEOUT_MS = 20000;

function failure(error: string): ProxyCheckResult {
	return { ok: false, latencyMs: null, error };
}

/**
 * Read `curl -w '%{http_code} %{time_total}'` output.
 *
 * A `000` status means curl never got an HTTP response (it exits non-zero too), so
 * it is not a successful test even when the error path is missed.
 */
export function parseCurlMeasurement(stdout: string): { latencyMs: number; status: number } | undefined {
	const [code, seconds] = stdout.trim().split(/\s+/);
	const status = Number(code);
	const elapsed = Number(seconds);
	if (!Number.isInteger(status) || status <= 0 || !Number.isFinite(elapsed) || elapsed < 0) return undefined;
	return { latencyMs: Math.round(elapsed * 1000), status };
}

/**
 * Fetch `url` from inside `container`.
 *
 * The URL is a separate argument, never part of a shell command: the operator
 * types it, and a profile test must not be a way to run a second command.
 */
async function curlThrough(container: string, url: string): Promise<ProxyCheckResult> {
	const result = await runDocker(
		[
			"exec",
			container,
			"curl",
			"-sS",
			"-o",
			"/dev/null",
			"-w",
			"%{http_code} %{time_total}",
			"--max-time",
			String(CURL_TIMEOUT_SECONDS),
			// `--url` rather than a bare argument: a value that starts with `-` must be
			// a URL to curl, not an option.
			"--url",
			url,
		],
		{ timeoutMs: (CURL_TIMEOUT_SECONDS + 10) * 1000 },
	);
	const measured = parseCurlMeasurement(result.stdout);
	if (result.code !== 0 || !measured) {
		const detail = `${result.stderr}`
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.slice(-2)
			.join(" ")
			.slice(-500);
		if (!detail) return failure(t("测试请求没有返回 HTTP 状态码"));
		return failure(t("测试请求失败（curl {code}）：{detail}", { code: result.code, detail }));
	}
	return { ok: true, latencyMs: measured.latencyMs, error: null };
}

/** The last lines a container wrote, for a tunnel that never came up. */
async function containerLogTail(container: string): Promise<string[]> {
	const logs = await runDocker(["logs", "--tail", "20", container], { timeoutMs: 15000 });
	return `${logs.stdout}\n${logs.stderr}`
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

/**
 * Wait for `wg-quick up` to have created the interface.
 *
 * The container's command keeps running even when `wg-quick` fails (`;` joins the
 * steps), so "the container is running" says nothing. The interface is the first
 * observable thing that means the configuration was accepted.
 */
async function waitForWireGuardInterface(container: string): Promise<{ ok: true } | { ok: false; error: string }> {
	const seconds = Math.round(TUNNEL_START_TIMEOUT_MS / 1000);
	const deadline = Date.now() + TUNNEL_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const state = await runDocker(["inspect", "-f", "{{.State.Status}}", container], { timeoutMs: 15000 });
		const status = state.stdout.trim();
		if (state.code !== 0 || status === "exited" || status === "dead") {
			const logs = await containerLogTail(container);
			return {
				ok: false,
				error: t("WireGuard 隧道没有建立：{detail}", { detail: logs.at(-1) ?? t("代理容器已退出") }),
			};
		}
		const probe = await runDocker(["exec", container, "ip", "link", "show", "wg0"], { timeoutMs: 15000 });
		if (probe.code === 0) return { ok: true };
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	const logs = await containerLogTail(container);
	return {
		ok: false,
		error: t("WireGuard 隧道没有在 {seconds} 秒内建立：{detail}", {
			seconds,
			detail: logs.at(-1) ?? t("没有可用日志"),
		}),
	};
}

/** A profile test's container, named so it can never collide with a sidecar. */
function testContainerName(): string {
	return `${containerPrefix()}proxytest-${randomUUID().slice(0, 8)}`;
}

/** The id used for the generated files of one test, removed with its container. */
function testFileId(): string {
	return `check-${randomUUID()}`;
}

/**
 * The `simple` path: the profile's outbound in a singleton batch-test container.
 *
 * `measure` is injectable so the configuration this hands to sing-box can be checked
 * without Docker. It is the only seam the other two modes do not have: they have no
 * outbound to build, only a client to run.
 */
async function checkSimpleProxy(
	agentDir: string,
	settings: SentinelProxySettings,
	url: string,
	measure: typeof measureNodes,
): Promise<ProxyCheckResult> {
	const resolved = proxyOutbounds(settings);
	if ("error" in resolved) return failure(resolved.error);
	const outbound = resolved.outbounds.find((entry) => entry.tag === resolved.tag);
	if (!outbound) return failure(t("这个代理没有生成出站配置"));
	const node: SentinelProxyNode = {
		tag: resolved.tag,
		name: `${settings.simple.server}:${settings.simple.port}`,
		protocol: typeof outbound.type === "string" ? outbound.type : settings.simple.type,
		outbound,
	};
	const measured = await measure([node], { agentDir, image: settings.image, url });
	if (measured.error) return failure(measured.error);
	const latency = measured.latencies?.get(node.tag);
	if (latency === undefined || latency === null) {
		return failure(t("代理没有在限定时间内返回：{url}", { url }));
	}
	return { ok: true, latencyMs: latency, error: null };
}

/** The WireGuard path: start the real sidecar shape, wait for wg0, fetch through it. */
async function checkWireGuard(
	agentDir: string,
	settings: SentinelProxySettings,
	url: string,
): Promise<ProxyCheckResult> {
	if (!(await hasImage())) {
		return failure(t("工具镜像 {image} 不存在，先在「环境」页构建", { image: SENTINEL_IMAGE }));
	}
	const written = writeProjectWireGuardConfig(agentDir, testFileId(), settings.wireguard);
	if (!written.ok) return failure(written.error);
	const container = testContainerName();
	try {
		const created = await createWireGuardContainer(
			container,
			written.path,
			SENTINEL_IMAGE,
			settings.wireguard.killSwitch,
		);
		if (!created.ok) {
			return failure(t("测试容器启动失败：{error}", { error: created.error ?? t("未知错误") }));
		}
		const up = await waitForWireGuardInterface(container);
		if (!up.ok) return failure(up.error);
		return await curlThrough(container, url);
	} finally {
		await runDocker(["rm", "-f", container], { timeoutMs: 30000 });
		rmSync(written.path, { force: true });
	}
}

/** The OpenVPN path: the same files and client the sidecar runs, then a fetch. */
async function checkOpenVpn(agentDir: string, settings: SentinelProxySettings, url: string): Promise<ProxyCheckResult> {
	if (!(await hasImage())) {
		return failure(t("工具镜像 {image} 不存在，先在「环境」页构建", { image: SENTINEL_IMAGE }));
	}
	const id = testFileId();
	const written = writeProjectOpenVpnFiles(agentDir, id, settings.openvpn);
	if (!written.ok) return failure(written.error);
	const container = testContainerName();
	try {
		const created = await createOpenVpnContainer(container, written.files, SENTINEL_IMAGE);
		if (!created.ok) {
			return failure(t("测试容器启动失败：{error}", { error: created.error ?? t("未知错误") }));
		}
		const up = await waitForOpenVpnTunnel(container);
		if (!up.ok) {
			return failure(t("OpenVPN 隧道没有建立：{error}", { error: up.error }));
		}
		return await curlThrough(container, url);
	} finally {
		await runDocker(["rm", "-f", container], { timeoutMs: 30000 });
		for (const path of [
			projectOpenVpnConfigPath(agentDir, id),
			projectOpenVpnAuthPath(agentDir, id),
			projectOpenVpnHookPath(agentDir, id),
			projectOpenVpnPushedDnsPath(agentDir, id),
		]) {
			rmSync(path, { force: true });
		}
	}
}

/**
 * Send a request to `url` through one profile's exit.
 *
 * A subscription is refused rather than guessed at: it has a list of nodes and an
 * "auto" choice, and the node picker's batch test already measures each of them
 * with the same mechanism. Testing "the profile" there would either pick a node
 * silently or hide which one answered.
 */
export async function checkProxyConnection(
	agentDir: string,
	settings: SentinelProxySettings,
	url: string,
	options: { measure?: typeof measureNodes } = {},
): Promise<ProxyCheckResult> {
	const target = url.trim();
	if (!target) return failure(t("测试地址不能为空"));
	// The result is an HTTP status and a round trip, so a URL without HTTP(S) has
	// nothing to report; rejecting it here also keeps curl from opening a local file.
	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return failure(t("测试地址不是有效的 URL"));
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return failure(t("测试地址要以 http:// 或 https:// 开头"));
	}
	try {
		if (settings.mode === "simple") {
			return await checkSimpleProxy(agentDir, settings, target, options.measure ?? measureNodes);
		}
		if (settings.mode === "wireguard") return await checkWireGuard(agentDir, settings, target);
		if (settings.mode === "openvpn") return await checkOpenVpn(agentDir, settings, target);
		return failure(t("订阅代理请用「节点」里的批量测速"));
	} catch (error) {
		return failure(
			t("测试代理时发生错误：{error}", { error: error instanceof Error ? error.message : String(error) }),
		);
	}
}

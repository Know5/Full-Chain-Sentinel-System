/**
 * Profile connectivity tests: does traffic really get out through this exit?
 *
 * The simple path is checked with an injected measurement, because the interesting
 * part there is the outbound handed to sing-box. The two tunnel paths run the same
 * container functions a project sidecar uses, against the fake docker from the rest
 * of the suite: what is pinned is that the tunnel is waited for, the request runs
 * inside it, and the container and its generated files are gone afterwards.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { SentinelProxyNode, SentinelProxySettings } from "../src/protocol.ts";
import { checkProxyConnection, parseCurlMeasurement } from "../src/proxy-check.ts";
import { installFakeDocker } from "./fake-docker.ts";

const roots: string[] = [];
const restores: Array<() => void> = [];

afterEach(() => {
	for (const restore of restores.splice(0)) restore();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(): { agentDir: string; logPath: string } {
	const root = mkdtempSync(join(tmpdir(), "sentinel-proxy-check-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	const logPath = join(root, "docker.log");
	const fake = installFakeDocker(root, join(root, "work"), logPath);
	restores.push(fake.restore);
	return { agentDir, logPath };
}

function settingsOf(overrides: Partial<SentinelProxySettings> = {}): SentinelProxySettings {
	return {
		mode: "simple",
		simple: { type: "socks5", server: "proxy.example", port: 1080, username: "", password: "", tls: false },
		wireguard: { config: "", dns: "", killSwitch: true },
		openvpn: { config: "", dns: "", username: "", password: "", killSwitch: true },
		nodes: [],
		nodeTag: "",
		image: "ghcr.io/sagernet/sing-box:v1.13.15",
		testUrl: "https://www.gstatic.com/generate_204",
		routePrivateDirect: true,
		...overrides,
	};
}

const WIREGUARD_CONFIG = `[Interface]
PrivateKey = cHJpdmF0ZQ==
Address = 10.66.0.2/32
DNS = 10.66.0.1

[Peer]
PublicKey = cHVibGlj
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0
`;

const OPENVPN_CONFIG = `client
dev tun
remote vpn.example.com 1194
dhcp-option DNS 10.8.0.1
<ca>
-----BEGIN CERTIFICATE-----
MIIB
-----END CERTIFICATE-----
</ca>
<key>
-----BEGIN PRIVATE KEY-----
MIIE
-----END PRIVATE KEY-----
</key>
`;

test("a simple proxy is measured through the outbound sing-box would run", async () => {
	const { agentDir } = setup();
	let seen: { nodes: SentinelProxyNode[]; url?: string; image?: string } | undefined;
	const result = await checkProxyConnection(
		agentDir,
		settingsOf({
			simple: { type: "http", server: "proxy.example", port: 8443, username: "u", password: "p", tls: true },
		}),
		"https://example.org/generate_204",
		{
			measure: async (nodes, options) => {
				seen = { nodes, url: options.url, image: options.image };
				return { latencies: new Map([[nodes[0]?.tag ?? "", 42]]) };
			},
		},
	);
	expect(result).toEqual({ ok: true, latencyMs: 42, error: null });
	expect(seen?.url).toBe("https://example.org/generate_204");
	expect(seen?.image).toBe("ghcr.io/sagernet/sing-box:v1.13.15");
	// The profile becomes the same outbound the sidecar gets, credentials included.
	expect(seen?.nodes[0]?.outbound).toMatchObject({
		type: "http",
		tag: "proxy",
		server: "proxy.example",
		server_port: 8443,
		username: "u",
		password: "p",
		tls: { enabled: true },
	});
});

test("a request that never comes back is a failed test, not a successful one", async () => {
	const { agentDir } = setup();
	const result = await checkProxyConnection(agentDir, settingsOf(), "https://example.org", {
		measure: async (nodes) => ({ latencies: new Map([[nodes[0]?.tag ?? "", null]]) }),
	});
	expect(result.ok).toBe(false);
	expect(result.error).toContain("限定时间");
});

test("a measurement that could not run reports the reason it gave", async () => {
	const { agentDir } = setup();
	const result = await checkProxyConnection(agentDir, settingsOf(), "https://example.org", {
		measure: async () => ({ error: "代理镜像不存在" }),
	});
	expect(result).toEqual({ ok: false, latencyMs: null, error: "代理镜像不存在" });
});

test("a subscription points at the node picker instead of guessing a node", async () => {
	const { agentDir } = setup();
	const result = await checkProxyConnection(agentDir, settingsOf({ mode: "subscription" }), "https://example.org");
	expect(result.ok).toBe(false);
	expect(result.error).toContain("批量测速");
});

test("a test URL must be HTTP(S), so the result always means a request", async () => {
	const { agentDir } = setup();
	const local = await checkProxyConnection(agentDir, settingsOf(), "file:///etc/passwd");
	expect(local.ok).toBe(false);
	expect(local.error).toContain("http");
	const malformed = await checkProxyConnection(agentDir, settingsOf(), "not a url");
	expect(malformed.ok).toBe(false);
	expect(malformed.error).toContain("URL");
});

test("curl output is read as a status and a round trip, never as a successful zero", () => {
	expect(parseCurlMeasurement("204 0.123\n")).toEqual({ latencyMs: 123, status: 204 });
	expect(parseCurlMeasurement("000 0.000")).toBeUndefined();
	expect(parseCurlMeasurement("")).toBeUndefined();
});

test("a WireGuard profile is tested in a real tunnel container and cleaned up", async () => {
	const { agentDir, logPath } = setup();
	const result = await checkProxyConnection(
		agentDir,
		settingsOf({ mode: "wireguard", wireguard: { config: WIREGUARD_CONFIG, dns: "", killSwitch: true } }),
		"https://example.org/generate_204",
	);
	expect(result).toEqual({ ok: true, latencyMs: 123, error: null });
	// The generated key file does not outlive the test.
	expect(readdirSync(join(agentDir, "proxy"))).toEqual([]);
	const log = readFileSync(logPath, "utf-8");
	expect(log).toMatch(/exec \S*proxytest-/);
	expect(log).toContain("rm -f");
});

test("an OpenVPN profile is tested through its own client and files, then removed", async () => {
	const { agentDir, logPath } = setup();
	const result = await checkProxyConnection(
		agentDir,
		settingsOf({
			mode: "openvpn",
			openvpn: { config: OPENVPN_CONFIG, dns: "", username: "", password: "", killSwitch: true },
		}),
		"https://example.org/generate_204",
	);
	expect(result).toEqual({ ok: true, latencyMs: 123, error: null });
	expect(readdirSync(join(agentDir, "proxy"))).toEqual([]);
	const log = readFileSync(logPath, "utf-8");
	expect(log).toContain("openvpn");
	expect(log).toContain("rm -f");
});

/**
 * Unit tests for the hub tools' evidence paths.
 *
 * The file tools run with the host project directory as cwd while bash runs in
 * the same directory at /work, so an agent can submit either name. The hub must
 * store and show the container name, and must not accept an arbitrary host path.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test } from "vitest";
import { AssetLibraryStore } from "../src/asset-library.ts";
import { createVulnerabilityTools, evidencePathsToContainer } from "../src/vuln-tool.ts";
import { VulnerabilityStore } from "../src/vulnerabilities.ts";

let root = "";
let store: VulnerabilityStore | undefined;

afterEach(() => {
	store?.close();
	store = undefined;
	if (root) rmSync(root, { recursive: true, force: true });
	root = "";
});

function createTools(workDir: string): { tools: ToolDefinition[]; store: VulnerabilityStore } {
	root = mkdtempSync(join(tmpdir(), "sentinel-vuln-tool-"));
	store = new VulnerabilityStore(join(root, "vulns.db"));
	return {
		store,
		tools: createVulnerabilityTools({
			store,
			getProject: () => ({ id: "p1", name: "测试项目" }),
			getSessionId: () => "s1",
			getSource: () => "测试",
			getWorkDir: () => workDir,
		}),
	};
}

interface CallResult {
	isError?: boolean;
	content: Array<{ type: string; text: string }>;
	details?: { id?: string };
}

type CallableTool = {
	name: string;
	execute: (toolCallId: string, params: never) => Promise<CallResult>;
};

function tool(tools: ToolDefinition[], name: string): CallableTool {
	const found = tools.find((item) => item.name === name);
	if (!found) throw new Error(`missing tool ${name}`);
	return found as unknown as CallableTool;
}

test("vuln_submit stores a host work-directory path as its /work name", async () => {
	const workDir = join(tmpdir(), "sentinel-project-1018");
	const { tools, store: hub } = createTools(workDir);
	const submit = tool(tools, "vuln_submit");
	const result = await submit.execute("c1", {
		title: "反序列化白名单绕过",
		severity: "critical",
		cvss: 9.8,
		target: "http://10.0.166.153:8000/",
		description: "getattr 白名单绕过导致命令执行",
		packet: "POST /",
		evidence: [{ kind: "file", path: join(workDir, "build2.py"), note: "利用脚本" }],
	} as never);
	expect(result.isError).not.toBe(true);
	const id = result.details?.id;
	expect(id).toBeTruthy();
	const vuln = hub.find("p1", id as string);
	expect(vuln?.evidence[0]?.path).toBe("/work/build2.py");
});

test("vuln_submit rejects evidence outside the work directory", async () => {
	const workDir = join(tmpdir(), "sentinel-project-1018");
	const { tools, store: hub } = createTools(workDir);
	const submit = tool(tools, "vuln_submit");
	const result = await submit.execute("c1", {
		title: "反序列化白名单绕过",
		severity: "critical",
		cvss: 9.8,
		target: "http://10.0.166.153:8000/",
		description: "getattr 白名单绕过导致命令执行",
		packet: "POST /",
		evidence: [{ kind: "file", path: "/etc/passwd", note: "越界文件" }],
	} as never);
	expect(result.isError).toBe(true);
	expect(hub.list("p1")).toHaveLength(0);
});

test("evidencePathsToContainer maps legacy host paths only inside the work directory", () => {
	const workDir = join(tmpdir(), "sentinel-project-1018");
	const { store: hub } = createTools(workDir);
	const legacy = hub.create({
		projectId: "p1",
		projectName: "测试项目",
		source: "测试",
		title: "历史记录",
		severity: "high",
		cvss: 8,
		target: "http://10.0.166.153:8000/",
		description: "旧记录里的宿主路径",
		packet: "POST /",
		evidence: [
			{ kind: "file", path: join(workDir, "build2.py") },
			{ kind: "file", path: "/work/evidence/nmap.txt" },
			{ kind: "file", path: "/etc/passwd" },
		],
	});
	const mapped = evidencePathsToContainer(legacy, workDir);
	expect(mapped.evidence.map((item) => item.path)).toEqual([
		"/work/build2.py",
		"/work/evidence/nmap.txt",
		"/etc/passwd",
	]);
});

test("vuln_submit links an asset and appends its timeline entry", async () => {
	const workDir = join(tmpdir(), "sentinel-project-1018");
	root = mkdtempSync(join(tmpdir(), "sentinel-vuln-asset-"));
	store = new VulnerabilityStore(join(root, "vulns.db"));
	const library = new AssetLibraryStore(join(root, "asset-library.db"));
	try {
		const asset = library.upsert({
			projectId: "p1",
			projectName: "测试项目",
			source: "测试",
			identity: { ip: "10.0.166.153", port: 8000 },
		}).asset;
		const tools = createVulnerabilityTools({
			store,
			getProject: () => ({ id: "p1", name: "测试项目" }),
			getSessionId: () => "s1",
			getSource: () => "测试",
			getWorkDir: () => workDir,
			resolveAsset: (ref) => {
				const found = library.find("p1", ref);
				return found ? { id: found.id, label: found.label } : undefined;
			},
			linkAsset: (assetId, vuln) => {
				library.appendEntry(assetId, {
					author: "agent",
					source: vuln.source,
					outcome: "vulnerable",
					method: "vuln_submit",
					text: `提交漏洞 ${vuln.label}：${vuln.title}`,
					vulnLabel: vuln.label,
				});
			},
		});
		const submit = tool(tools, "vuln_submit");
		const result = await submit.execute("c1", {
			title: "未授权访问",
			severity: "high",
			cvss: 7.5,
			target: "http://10.0.166.153:8000/",
			description: "描述",
			packet: "GET /",
			asset: asset.label,
		} as never);
		expect(result.isError).not.toBe(true);
		const vulnId = result.details?.id as string;
		const vuln = store.find("p1", vulnId);
		expect(vuln?.assetId).toBe(asset.id);
		expect(vuln?.assetLabel).toBe(asset.label);
		const linked = library.get(asset.id);
		expect(linked?.testCount).toBe(1);
		expect(linked?.lastOutcome).toBe("vulnerable");
		expect(linked?.status).toBe("tested");
		expect(linked?.entries.at(-1)?.vulnLabel).toBe(vuln?.label);

		const list = tool(tools, "vuln_list");
		const listed = await list.execute("c2", {} as never);
		expect(listed.content[0]?.text).toContain(`资产 ${asset.label}`);

		const unknown = await submit.execute("c3", {
			title: "另一条",
			severity: "low",
			cvss: 2,
			target: "http://10.0.166.153:8000/",
			description: "描述",
			packet: "GET /",
			asset: "NOPE-A9999",
		} as never);
		expect(unknown.isError).toBe(true);
		expect(store.list("p1")).toHaveLength(1);
	} finally {
		library.close();
	}
});

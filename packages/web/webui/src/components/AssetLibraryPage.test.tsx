/**
 * Render smoke tests for the inventory page: the project empty state, the two
 * empty states, the paged table, the delete impact dialog, the detail timeline
 * and the vulnerable-without-finding warning. No browser is needed; the point
 * is a null dereference or a missing control failing here first.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type {
	SentinelAsset,
	SentinelAssetDetail,
	SentinelAssetStats,
	SentinelAssetSummary,
	SentinelVulnSummary,
} from "../types.ts";
import { AssetLibraryPage } from "./AssetLibraryPage.tsx";

const AT = "2026-10-26T10:00:00.000Z";

const stats: SentinelAssetStats = {
	total: 2,
	byKind: { domain: 1, ip: 0, service: 1, url: 0 },
	byStatus: { pending: 1, testing: 0, tested: 1, out_of_scope: 0 },
	tested: 1,
	untested: 1,
};

function summary(overrides: Partial<SentinelAssetSummary> = {}): SentinelAssetSummary {
	return {
		id: "a1",
		label: "E2E-A0001",
		number: 1,
		projectId: "p1",
		projectName: "E2E",
		kind: "domain",
		name: "admin.example.com",
		host: "admin.example.com",
		domain: "admin.example.com",
		tags: ["OA"],
		status: "tested",
		source: "主代理",
		testCount: 2,
		lastOutcome: "clean",
		lastTestedAt: AT,
		firstSeenAt: AT,
		lastSeenAt: AT,
		createdAt: AT,
		updatedAt: AT,
		...overrides,
	};
}

function detail(overrides: Partial<SentinelAsset> = {}, vulns: SentinelVulnSummary[] = []): SentinelAssetDetail {
	return {
		asset: {
			...summary(),
			entries: [
				{
					seq: 1,
					kind: "record",
					at: AT,
					author: "agent",
					source: "主代理",
					outcome: "clean",
					method: "nmap -sV",
					text: "仅 80/443 开放",
				},
				{
					seq: 2,
					kind: "status",
					at: AT,
					author: "operator",
					outcome: "note",
					text: "状态 待测试 → 已测试",
				},
			],
			...overrides,
		},
		vulns,
	};
}

const base = {
	items: [summary()],
	stats,
	total: 2,
	page: 1,
	pageSize: 50,
	hasMore: false,
	filters: {},
	detail: null,
	deletePending: null,
	deletePreview: null,
	projectName: "E2E",
	hasProject: true,
	onQuery: () => {},
	onOpen: () => {},
	onCloseDetail: () => {},
	onUpdate: () => {},
	onRequestDelete: () => {},
	onConfirmDelete: () => {},
	onCancelDelete: () => {},
	onExport: () => {},
	onOpenVuln: () => {},
};

test("without a project the page states the rule", () => {
	const html = renderToStaticMarkup(<AssetLibraryPage {...base} hasProject={false} />);
	expect(html).toContain("尚未选择项目");
	expect(html).toContain("资产库按项目隔离");
});

test("a project with no assets explains how they arrive", () => {
	const empty: SentinelAssetStats = {
		total: 0,
		byKind: { domain: 0, ip: 0, service: 0, url: 0 },
		byStatus: { pending: 0, testing: 0, tested: 0, out_of_scope: 0 },
		tested: 0,
		untested: 0,
	};
	const html = renderToStaticMarkup(<AssetLibraryPage {...base} items={[]} stats={empty} total={0} />);
	expect(html).toContain("还没有资产记录");
	expect(html).toContain("asset_report");
});

test("the table renders the label, kind, state and test summary plus the pager", () => {
	const service = summary({
		id: "a2",
		label: "E2E-A0002",
		number: 2,
		kind: "service",
		name: "10.0.0.5:443",
		host: "10.0.0.5",
		domain: undefined,
		ip: "10.0.0.5",
		port: 443,
		transport: "tcp",
		protocol: "https",
		status: "pending",
		testCount: 0,
		lastOutcome: undefined,
		lastTestedAt: undefined,
	});
	const html = renderToStaticMarkup(
		<AssetLibraryPage {...base} items={[summary(), service]} total={51} page={1} hasMore />,
	);
	expect(html).toContain("E2E-A0001");
	expect(html).toContain("E2E-A0002");
	expect(html).toContain("10.0.0.5:443");
	expect(html).toContain("2 · 无发现");
	expect(html).toContain("—");
	expect(html).toContain("全选本页");
	expect(html).toContain("下一页");
	expect(html).toContain("每页 50");
});

test("the delete dialog states assets, timeline entries and unlinked findings", () => {
	const html = renderToStaticMarkup(
		<AssetLibraryPage
			{...base}
			deletePending={["a1", "a2"]}
			deletePreview={{ count: 2, records: 5, vulns: 1 }}
		/>,
	);
	expect(html).toContain("将删除 2 条资产");
	expect(html).toContain("5 条时间线记录");
	expect(html).toContain("1 条漏洞的关联会被解除");
});

test("the detail renders both timeline kinds, linked findings and the warning", () => {
	const vuln = { id: "v1", label: "E2E-0003", severity: "high", status: "pending", title: "注入" } as SentinelVulnSummary;
	const withVuln = renderToStaticMarkup(
		<AssetLibraryPage {...base} detail={detail({}, [vuln])} />,
	);
	expect(withVuln).toContain("时间线");
	expect(withVuln).toContain("仅 80/443 开放");
	expect(withVuln).toContain("状态 待测试 → 已测试");
	expect(withVuln).toContain("E2E-0003");
	expect(withVuln).toContain("关联漏洞");

	const orphan = renderToStaticMarkup(
		<AssetLibraryPage
			{...base}
			detail={detail({ lastOutcome: "vulnerable", lastTestedAt: AT }, [])}
		/>,
	);
	expect(orphan).toContain("没有关联的漏洞中枢记录");
});

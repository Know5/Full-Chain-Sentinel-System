/**
 * The audit page is a table-first view: filters, KPI strip, dense table, and a
 * detail drawer opened from a row. The drawer renders through a portal, so
 * these assertions cover the page itself; the drawer content is exercised by
 * the browser check.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { SentinelSupervisorAuditItem, SentinelSupervisorAuditPage } from "../types.ts";
import { SupervisorAuditPage } from "./SupervisorAuditPage.tsx";

function item(overrides: Partial<SentinelSupervisorAuditItem> = {}): SentinelSupervisorAuditItem {
	return {
		sessionId: "s1",
		sessionPath: "/tmp/s1.jsonl",
		sessionName: "支付接口复测",
		projectId: "p1",
		projectName: "支付网关",
		mode: "observe",
		delivery: "confirm",
		strategy: "steady",
		strategyCustomId: null,
		strategyName: "稳健交付",
		strategyInstructions: "",
		strategyNote: "",
		status: "running",
		armedAt: 1,
		startedAt: 2,
		endedAt: null,
		updatedAt: 1_700_000_000_000,
		episodeCount: 3,
		callCount: 42,
		phase: "vuln_mapping",
		intent: "重复测试 SQLi",
		progress: "stalled",
		adviceCount: 1,
		usage: { input: 10_000, output: 2_400, total: 12_400 },
		lastError: null,
		...overrides,
	};
}

const page: SentinelSupervisorAuditPage = {
	items: [item()],
	total: 1,
	page: 1,
	pageSize: 30,
	stats: { total: 1, advancing: 0, stalled: 1, looping: 0, stopped: 0, pendingAdvice: 1 },
};

function render(withDetail = false, data: SentinelSupervisorAuditPage | null = page): string {
	return renderToStaticMarkup(
		<SupervisorAuditPage
			page={data}
			detail={withDetail ? { session: item(), episodes: [], logs: [], advice: [] } : null}
			projects={[{ id: "p1", name: "支付网关", cwd: "/tmp" }]}
			customStrategies={[]}
			onQuery={() => {}}
			onSelect={() => {}}
			onBack={() => {}}
			onOpenSession={() => {}}
		/>,
	);
}

describe("SupervisorAuditPage", () => {
	test("renders the filters, the KPI strip and the table", () => {
		const html = render();
		expect(html).toContain("全部模式");
		expect(html).toContain("全部进度");
		expect(html).toContain("全部预设");
		expect(html).toContain("监督会话");
		expect(html).toContain("支付接口复测");
		expect(html).toContain("12.4k");
		expect(html).toContain("待确认建议");
		expect(html).toContain("已停止");
		expect(html).toContain("稳健交付");
	});

	test("the row carries the session status, its mode, phase and progress", () => {
		const html = render();
		expect(html).toContain("监督中");
		expect(html).toContain("观察");
		expect(html).toContain("漏洞验证");
		expect(html).toContain("停滞");
	});

	test("a session with no supervision record explains how records appear", () => {
		const empty = render(false, {
			items: [],
			total: 0,
			page: 1,
			pageSize: 30,
			stats: { total: 0, advancing: 0, stalled: 0, looping: 0, stopped: 0, pendingAdvice: 0 },
		});
		expect(empty).toContain("还没有开启过监督的会话");
		expect(empty).toContain("监督");
	});

	test("opening a row does not replace the table: the detail is an overlay", () => {
		const html = render(true);
		expect(html).toContain("支付接口复测");
		expect(html).toContain("监督");
	});
});

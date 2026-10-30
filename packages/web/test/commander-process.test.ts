import { expect, test } from "vitest";
import { commanderEntries } from "../webui/src/commander-process.ts";
import type { SentinelSubagentEvent } from "../webui/src/types.ts";

test("concurrent calls of the same tool keep their own results and their starting positions", () => {
	const events: SentinelSubagentEvent[] = [
		{ seq: 1, at: 100, kind: "tool_start", toolCallId: "a", toolName: "dispatch_task", args: { title: "任务 A" } },
		{ seq: 2, at: 200, kind: "tool_start", toolCallId: "b", toolName: "dispatch_task", args: { title: "任务 B" } },
		{ seq: 3, at: 300, kind: "text", from: "operator", text: "优先验证任务 A" },
		{ seq: 4, at: 400, kind: "tool_end", toolCallId: "b", output: "B 失败", isError: true },
		{ seq: 5, at: 500, kind: "tool_end", toolCallId: "a", output: "A 已启动" },
	];
	expect(commanderEntries(events)).toEqual([
		{ kind: "tool", start: events[0], end: events[4] },
		{ kind: "tool", start: events[1], end: events[3] },
		{ kind: "event", event: events[2] },
	]);
});

test("a running call gains its result without changing the entry's starting sequence", () => {
	const start: SentinelSubagentEvent = { seq: 8, at: 100, kind: "tool_start", toolCallId: "a", toolName: "get_tasks" };
	const end: SentinelSubagentEvent = {
		seq: 9,
		at: 600,
		kind: "tool_end",
		toolCallId: "a",
		output: "5 tasks",
		truncated: true,
	};
	expect(commanderEntries([start])).toEqual([{ kind: "tool", start, end: undefined }]);
	expect(commanderEntries([start, end])).toEqual([{ kind: "tool", start, end }]);
});

test("partial logs retain orphaned results and never pair unrelated calls without IDs", () => {
	const events: SentinelSubagentEvent[] = [
		{ seq: 1, at: 100, kind: "tool_start", toolName: "get_tasks" },
		{ seq: 2, at: 200, kind: "tool_end", toolName: "get_tasks", output: "orphaned output" },
		{ seq: 3, at: 300, kind: "tool_end", toolCallId: "missing", output: "retained result" },
	];
	expect(commanderEntries(events)).toEqual([
		{ kind: "tool", start: events[0], end: undefined },
		{ kind: "tool", start: events[1], end: events[1] },
		{ kind: "tool", start: events[2], end: events[2] },
	]);
});

test("thinking, operator messages and status errors survive while turn bookkeeping stays hidden", () => {
	const events: SentinelSubagentEvent[] = [
		{ seq: 1, at: 100, kind: "thinking", text: "核对任务" },
		{ seq: 2, at: 200, kind: "text", from: "operator", text: "优先处理鉴权" },
		{ seq: 3, at: 300, kind: "turn", text: "第 1 轮" },
		{ seq: 4, at: 400, kind: "status", status: "error", note: "指挥官调用失败" },
	];
	expect(commanderEntries(events)).toEqual(
		[events[0], events[1], events[3]].map((event) => ({ kind: "event", event })),
	);
});

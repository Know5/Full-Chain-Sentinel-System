/**
 * Render smoke test for the loop-guard notice rows.
 *
 * The guard injects its reminders as `custom_message` entries, and the console
 * decides what to show from the message's `customType` plus the marker at the
 * start of its content. Getting either wrong renders nothing at all, which is a
 * silent failure: the model was interrupted and the operator sees no reason why.
 *
 * It lives next to the component rather than in `test/`: the root TypeScript
 * project has no JSX, so only the webui project can type-check a file that
 * imports a `.tsx` module.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { AgentMessageView } from "../types.ts";
import { MessageView } from "./MessageView.tsx";
import { ToolCard } from "./ToolCard.tsx";

function custom(customType: string, content: string): AgentMessageView {
	return { role: "custom", customType, content, timestamp: 1_700_000_000_000 };
}

test("a stutter notice folds under its own label", () => {
	const html = renderToStaticMarkup(
		createElement(MessageView, {
			message: custom("zg-loop-guard", "【输出重复】上一次输出陷入了重复（同一行连续出现 6 次），已被提前中止。"),
		}),
	);
	expect(html).toContain("输出重复已中止");
	expect(html).toContain("foldrow is-warn");
	expect(html).toContain("ant-tag-red");
	expect(html).toContain("【输出重复】");
});

test("a repeated tool call folds under the reminder label", () => {
	const html = renderToStaticMarkup(
		createElement(MessageView, {
			message: custom("zg-loop-guard", "【重复工具调用】同一个工具调用（bash）已经连续重复 3 次，参数完全一样。"),
		}),
	);
	expect(html).toContain("重复工具调用提醒");
	expect(html).toContain("foldrow is-warn");
	expect(html).toContain("ant-tag-orange");
});

test("an unknown custom message still renders nothing", () => {
	const html = renderToStaticMarkup(createElement(MessageView, { message: custom("sentinel-unknown", "不应该出现的内容") }));
	expect(html).toBe("");
});

test("a supervisor advice message stays visible and auditable", () => {
	const html = renderToStaticMarkup(
		createElement(MessageView, {
			message: custom(
				"zg-supervisor-advice",
				"【监督建议 · 非操作员指令】\n判断：SQLi 已排除\n建议下一步：转向 IDOR",
			),
		}),
	);
	expect(html).toContain("监督建议已介入");
	expect(html).toContain("supervisor-advice-row");
	expect(html).toContain("转向 IDOR");
});

/**
 * A settled run folds a thinking block into one StepRow with a three-line
 * preview. The row's 「还有 N 行」 button used to be a dead end: the row called
 * `onFullscreen` but the thinking branches never forwarded it, so the click
 * landed nowhere. The button's tooltip names its destination, which makes the
 * forwarding visible to a static render.
 */
function thinkingOnly(text: string): AgentMessageView {
	return {
		role: "assistant",
		content: [{ type: "thinking", thinking: text }],
		timestamp: 1_700_000_000_000,
	};
}

const LONG_THINKING = Array.from({ length: 9 }, (_, index) => `第 ${index + 1} 行推理`).join("\n");

test("a thinking row opens the shared viewer from its fullscreen action", () => {
	const html = renderToStaticMarkup(
		createElement(MessageView, {
			message: thinkingOnly(LONG_THINKING),
			compact: true,
			onFullscreen: () => {},
		}),
	);
	// The row is one collapsible line: time, 思考 tag and the first line.
	expect(html).toContain("steprow");
	expect(html).toContain("思考");
	expect(html).toContain("在查看器中打开全部内容");
});

test("a thinking row without a viewer still expands in place", () => {
	const html = renderToStaticMarkup(
		createElement(MessageView, { message: thinkingOnly(LONG_THINKING), compact: true }),
	);
	// The collapsible row itself is the expansion affordance; no dead button.
	expect(html).toContain("ant-collapse");
	expect(html).toContain("第 1 行推理");
	expect(html).not.toContain("在查看器中打开全部内容");
});

test("a live tool card keeps the call time at the front", () => {
	const html = renderToStaticMarkup(
		createElement(ToolCard, {
			name: "droid_shell",
			status: "running",
			time: "20:31:50",
			command: "id",
			output: "",
		}),
	);
	expect(html).toContain('toolcard__time');
	expect(html).toContain("20:31:50");
});

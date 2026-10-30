import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { SESSION_STATUSES, SESSION_STATUS_LABELS } from "../components/SessionStatusControl.tsx";
import type { SessionInfoView } from "../types.ts";
import { SessionPanel } from "./SessionPanel.tsx";

afterEach(() => vi.unstubAllGlobals());

function renderSessions(sessions: SessionInfoView[], running = false): string {
	return renderToStaticMarkup(
		createElement(SessionPanel, {
			sessions,
			activeSessionId: sessions[0]?.id ?? null,
			runningSessions: running ? sessions.map((session) => session.id) : [],
			engines: [],
			onNew: () => {},
			onSwitch: () => {},
			onRename: () => {},
			onDelete: () => {},
			onSetStatus: () => {},
		}),
	);
}

const session: SessionInfoView = {
	id: "one",
	path: "/sessions/one.jsonl",
	cwd: "/work",
	name: "API review",
	firstMessage: "Review the API",
	messageCount: 2,
	created: "2026-10-30T00:00:00Z",
	modified: "2026-10-30T00:00:00Z",
};

test("every manual mark is visible in the conversation list without opening its menu", () => {
	for (const status of SESSION_STATUSES) {
		expect(renderSessions([{ ...session, status }])).toContain(
			`class="session-row__status">${SESSION_STATUS_LABELS[status]}</span>`,
		);
	}
});

test("running conversations and engineering tasks retain their manual mark", () => {
	const marked = { ...session, status: "todo" as const };
	expect(renderSessions([marked], true)).toContain('class="session-row__status">待跟进</span>');
	expect(
		renderSessions([{ ...marked, engine: { engineId: "engine", engineName: "Review", taskStatus: "running" } }]),
	).toContain('class="session-row__status">待跟进</span>');
});

test("clearing a mark removes its label from the conversation row", () => {
	expect(renderSessions([session])).not.toContain('class="session-row__status"');
});

const conversations: SessionInfoView[] = [
	{ ...session, id: "unmarked", path: "/unmarked.jsonl", name: "Unmarked conversation" },
	...SESSION_STATUSES.map((status) => ({
		...session,
		id: status,
		path: `/${status}.jsonl`,
		name: `${status} conversation`,
		status,
	})),
];

test("each status filter includes only conversations with that manual mark", () => {
	for (const status of [...SESSION_STATUSES, "none"]) {
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => key === "sentinel-session-filter" ? JSON.stringify([status]) : null,
		});
		const html = renderSessions(conversations);
		for (const conversation of conversations) {
			expect(html.includes(`title="${conversation.name}"`)).toBe((conversation.status ?? "none") === status);
		}
	}
});

test("multiple statuses are combined and can include unmarked conversations", () => {
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => key === "sentinel-session-filter" ? '["todo","done","none"]' : null,
	});
	const html = renderSessions(conversations);
	expect(html).toContain('title="todo conversation"');
	expect(html).toContain('title="done conversation"');
	expect(html).toContain('title="Unmarked conversation"');
	expect(html).not.toContain('title="active conversation"');
	expect(html).not.toContain('title="ignored conversation"');
});

test("status filtering combines with the engineering source filter", () => {
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => {
			if (key === "sentinel-session-filter") return '["done"]';
			if (key === "sentinel-session-source") return "engine";
			return null;
		},
	});
	const html = renderSessions([
		...conversations,
		{ ...session, id: "task", path: "/task.jsonl", name: "Engineering task", status: "done", engine: { engineId: "engine", engineName: "Review", taskStatus: "running" } },
	]);
	expect(html).toContain('title="Engineering task"');
	for (const conversation of conversations) expect(html).not.toContain(`title="${conversation.name}"`);
});

test("empty or malformed stored status filters show all conversations", () => {
	for (const stored of ["[]", '"invalid"', "invalid", '["unknown",3]']) {
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => key === "sentinel-session-filter" ? stored : null,
		});
		const html = renderSessions(conversations);
		for (const conversation of conversations) expect(html).toContain(`title="${conversation.name}"`);
	}
});

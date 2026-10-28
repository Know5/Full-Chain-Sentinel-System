/**
 * The conversation rail of the chat page.
 *
 * Sessions used to grow inside the global sider, which made the navigation
 * change shape every time a task started. A conversation belongs to the chat
 * workspace, so it lives here: one filterable list, engine conversations
 * grouped under their engine, and the row actions behind a menu instead of a
 * hover card.
 */

import { DeleteOutlined, EditOutlined, MoreOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Badge, Button, Dropdown, Empty, Input, Modal, Segmented, Select, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import { useMemo, useState } from "react";
import { t } from "../i18n.ts";
import type { SentinelEngine, SentinelSessionStatus, SessionInfoView } from "../types.ts";
import { SESSION_STATUS_LABELS } from "../components/SessionStatusControl.tsx";

const { Text } = Typography;

type StatusFilter = "all" | "open";
type SourceFilter = "all" | "chat" | "engine";

const STORAGE_STATUS = "sentinel-session-filter";
const STORAGE_SOURCE = "sentinel-session-source";

function readStatusFilter(): StatusFilter {
	try {
		return localStorage.getItem(STORAGE_STATUS) === "open" ? "open" : "all";
	} catch {
		return "all";
	}
}

function readSourceFilter(): SourceFilter {
	try {
		const stored = localStorage.getItem(STORAGE_SOURCE);
		return stored === "chat" || stored === "engine" ? stored : "all";
	} catch {
		return "all";
	}
}

/** The dot says what the session is doing; the menu says what the operator decided. */
function dotStatus(session: SessionInfoView, running: boolean): "success" | "processing" | "warning" | "default" | "error" {
	if (session.engine) {
		switch (session.engine.taskStatus) {
			case "running":
			case "queued":
				return "processing";
			case "done":
				return "success";
			case "failed":
			case "aborted":
				return "error";
			case "blocked":
			case "paused":
				return "warning";
			default:
				return "default";
		}
	}
	if (running) return "processing";
	if (session.status === "active") return "warning";
	if (session.status === "done") return "success";
	if (session.status === "ignored") return "default";
	return "default";
}

function rowLabel(session: SessionInfoView): string {
	const raw = session.name ?? session.firstMessage.slice(0, 60);
	const prefix = session.engine?.engineName;
	if (prefix && raw.startsWith(`${prefix} · `)) return raw.slice(prefix.length + 3);
	return raw || t("未命名会话");
}

export interface SessionPanelProps {
	sessions: SessionInfoView[];
	activeSessionId: string | null;
	runningSessions: string[];
	engines: SentinelEngine[];
	onNew: () => void;
	onSwitch: (path: string) => void;
	onRename: (path: string, name: string) => void;
	onDelete: (path: string) => void;
	onSetStatus: (path: string, status: SentinelSessionStatus | null) => void;
}

export function SessionPanel({
	sessions,
	activeSessionId,
	runningSessions,
	onNew,
	onSwitch,
	onRename,
	onDelete,
	onSetStatus,
}: SessionPanelProps) {
	const { modal } = App.useApp();
	const [query, setQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>(readStatusFilter);
	const [sourceFilter, setSourceFilter] = useState<SourceFilter>(readSourceFilter);
	const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null);

	const setStatus = (next: StatusFilter) => {
		localStorage.setItem(STORAGE_STATUS, next);
		setStatusFilter(next);
	};
	const setSource = (next: SourceFilter) => {
		localStorage.setItem(STORAGE_SOURCE, next);
		setSourceFilter(next);
	};

	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return sessions.filter((session) => {
			if (statusFilter === "open" && (session.status === "done" || session.status === "ignored")) return false;
			if (sourceFilter === "chat" && session.engine) return false;
			if (sourceFilter === "engine" && !session.engine) return false;
			if (!needle) return true;
			return rowLabel(session).toLowerCase().includes(needle) || session.firstMessage.toLowerCase().includes(needle);
		});
	}, [sessions, statusFilter, sourceFilter, query]);

	const chatSessions = visible.filter((session) => !session.engine);
	const engineGroups = useMemo(() => {
		const groups = new Map<string, { name: string; sessions: SessionInfoView[] }>();
		for (const session of visible) {
			if (!session.engine) continue;
			const group = groups.get(session.engine.engineId) ?? { name: session.engine.engineName, sessions: [] };
			group.sessions.push(session);
			groups.set(session.engine.engineId, group);
		}
		return [...groups.values()];
	}, [visible]);

	const menuFor = (session: SessionInfoView): MenuProps => ({
		items: [
			{ key: "rename", icon: <EditOutlined />, label: t("重命名") },
			{ type: "divider" },
			{
				key: "status",
				label: t("标记状态"),
				children: [
					...(Object.keys(SESSION_STATUS_LABELS) as SentinelSessionStatus[]).map((status) => ({
						key: `status:${status}`,
						label: (
							<span className="session-status-option">
								<Badge status={status === "done" ? "success" : status === "ignored" ? "default" : "processing"} />
								{SESSION_STATUS_LABELS[status]}
							</span>
						),
					})),
					{ type: "divider" as const },
					{ key: "status:none", label: t("清除标记") },
				],
			},
			{ type: "divider" },
			{ key: "delete", icon: <DeleteOutlined />, label: t("删除会话"), danger: true },
		],
		onClick: ({ key, domEvent }) => {
			domEvent.stopPropagation();
			if (key === "rename") setRenaming({ path: session.path, name: rowLabel(session) });
			if (key === "delete") {
				modal.confirm({
					title: t("删除会话"),
					content: t("删除「{name}」？该操作不可恢复。", { name: rowLabel(session) }),
					okText: t("删除"),
					okButtonProps: { danger: true },
					cancelText: t("取消"),
					onOk: () => onDelete(session.path),
				});
			}
			if (key.startsWith("status:")) {
				const value = key.slice("status:".length);
				onSetStatus(session.path, value === "none" ? null : (value as SentinelSessionStatus));
			}
		},
	});

	const row = (session: SessionInfoView) => {
		const active = session.id === activeSessionId;
		const running = runningSessions.includes(session.id);
		return (
			<div
				key={session.path}
				className={active ? "session-row is-active" : "session-row"}
				role="button"
				tabIndex={0}
				aria-current={active ? "true" : undefined}
				onClick={() => onSwitch(session.path)}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onSwitch(session.path);
					}
				}}
			>
				<Badge status={dotStatus(session, running)} className="session-row__dot" />
				<span className="session-row__name" title={rowLabel(session)}>
					{rowLabel(session)}
				</span>
				<Dropdown menu={menuFor(session)} trigger={["click"]} placement="bottomRight">
					<Button
						type="text"
						size="small"
						className="session-row__more"
						icon={<MoreOutlined />}
						onClick={(event) => event.stopPropagation()}
						aria-label={t("会话操作")}
					/>
				</Dropdown>
			</div>
		);
	};

	return (
		<aside className="session-panel">
			<div className="session-panel__head">
				<Text strong className="session-panel__title">
					{t("会话")}
				</Text>
				<Text type="secondary" className="session-panel__count">
					{visible.length === sessions.length
						? sessions.length
						: `${visible.length} / ${sessions.length}`}
				</Text>
				<Tooltip title={t("新建会话")}>
					<Button type="primary" size="small" icon={<PlusOutlined />} onClick={onNew} aria-label={t("新建会话")} />
				</Tooltip>
			</div>

			<Input
				size="small"
				allowClear
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				prefix={<SearchOutlined className="session-panel__search-icon" />}
				placeholder={t("搜索会话")}
			/>

			<div className="session-panel__filters">
				<Segmented
					size="small"
					value={statusFilter}
					onChange={(value) => setStatus(value as StatusFilter)}
					options={[
						{ label: t("全部"), value: "all" },
						{ label: t("未完成"), value: "open" },
					]}
				/>
				<Select
					size="small"
					value={sourceFilter}
					onChange={(value) => setSource(value as SourceFilter)}
					options={[
						{ label: t("全部来源"), value: "all" },
						{ label: t("对话"), value: "chat" },
						{ label: t("工程"), value: "engine" },
					]}
					className="session-panel__source"
				/>
			</div>

			<div className="session-panel__list">
				{visible.length === 0 ? (
					<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有匹配的会话")} />
				) : null}
				{chatSessions.length > 0 && engineGroups.length > 0 ? (
					<div className="session-panel__section">{t("对话")}</div>
				) : null}
				{chatSessions.map(row)}
				{engineGroups.map((group) => (
					<div key={group.name}>
						<div className="session-panel__section">
							{group.name}
							<span className="session-panel__section-count">{group.sessions.length}</span>
						</div>
						{group.sessions.map(row)}
					</div>
				))}
			</div>

			<Modal
				title={t("重命名会话")}
				open={renaming !== null}
				okText={t("保存")}
				cancelText={t("取消")}
				onCancel={() => setRenaming(null)}
				destroyOnHidden
				onOk={() => {
					if (!renaming) return;
					const name = renaming.name.trim();
					if (!name) return;
					onRename(renaming.path, name);
					setRenaming(null);
				}}
			>
				<Input
					autoFocus
					value={renaming?.name ?? ""}
					onChange={(event) => setRenaming((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
					onPressEnter={() => {
						if (!renaming) return;
						const name = renaming.name.trim();
						if (!name) return;
						onRename(renaming.path, name);
						setRenaming(null);
					}}
				/>
			</Modal>
		</aside>
	);
}

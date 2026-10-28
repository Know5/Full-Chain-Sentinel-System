/**
 * 工程模式页面：工程列表 → 工程看板。
 *
 * Visual language follows the console: light page cards with ws-panel headers,
 * data-table rows for the engine list and the task board, tag badges for
 * statuses, and dark blocks only for terminal output. Layout per the approved
 * mockup (variant A): the list is a table, the board splits 7:5 between the
 * task board and the commander's light conversation feed, task details open in
 * a vulnerability-style modal, and the create form is a full page.
 */

import { PlusOutlined, ReadOutlined } from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import type { ProColumns } from "@ant-design/pro-components";
import {
	Alert,
	Button,
	Card,
	Checkbox,
	Col,
	Collapse,
	Descriptions,
	Empty,
	Form,
	Input,
	InputNumber,
	Modal,
	Popconfirm,
	Radio,
	Row,
	Segmented,
	Space,
	Steps,
	Table,
	Tag,
	Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n.ts";
import { Page } from "../ui/Page.tsx";
import type {
	SentinelDoctrineView,
	SentinelEngine,
	SentinelEngineGateMode,
	SentinelEngineLimits,
	SentinelEngineSchedule,
	SentinelEngineScheduleAction,
	SentinelEngineScheduleInput,
	SentinelEngineTask,
	SentinelEngineTaskStatus,
	SentinelPresetView,
	SentinelSubagentEvent,
} from "../types.ts";

const { Text, Title } = Typography;

const TASK_STATUS_LABELS: Record<SentinelEngineTaskStatus, string> = {
	queued: t("排队中"),
	running: t("运行中"),
	done: t("已完成"),
	failed: t("失败"),
	blocked: t("已阻塞"),
	aborted: t("已中止"),
	paused: t("已暂停"),
};

const TASK_STATUS_CLASS: Record<SentinelEngineTaskStatus, string> = {
	queued: "tag-queued",
	running: "tag-running",
	done: "tag-done",
	failed: "tag-failed",
	blocked: "tag-blocked",
	aborted: "tag-aborted",
	paused: "tag-paused",
};

const ENGINE_STATUS_LABELS: Record<SentinelEngine["status"], string> = {
	scheduled: t("已计划"),
	running: t("运行中"),
	paused: t("已暂停"),
	completed: t("已完成"),
	stopped: t("已终止"),
};

const ENGINE_STATUS_CLASS: Record<SentinelEngine["status"], string> = {
	scheduled: "tag-scheduled",
	running: "tag-running",
	paused: "tag-paused",
	completed: "tag-done",
	stopped: "tag-stopped",
};

/** antd Tag colours for the same states, used by the antd list view. */
const ENGINE_STATUS_COLORS: Record<SentinelEngine["status"], string> = {
	scheduled: "blue",
	running: "processing",
	paused: "orange",
	completed: "green",
	stopped: "default",
};

function formatDuration(ms: number): string {
	const minutes = Math.floor(ms / 60000);
	if (minutes < 60) return t("{minutes} 分钟", { minutes });
	return t("{hours} 小时 {rest} 分", { hours: Math.floor(minutes / 60), rest: minutes % 60 });
}

function formatUsage(total: number | null | undefined): string {
	if (!total) return "—";
	if (total < 1000) return String(total);
	if (total < 1_000_000) return `${(total / 1000).toFixed(1)}k`;
	return `${(total / 1_000_000).toFixed(1)}M`;
}

function formatClock(at: number): string {
	return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
}

const SCHEDULE_PHASE_LABELS: Record<SentinelEngineSchedule["phase"], string> = {
	waiting_start: t("等待开始"),
	running: t("计划运行中"),
	paused: t("计划暂停中"),
	finished: t("计划已结束"),
};

const SCHEDULE_FINISH_LABELS: Record<NonNullable<SentinelEngineSchedule["finishedReason"]>, string> = {
	completed: t("工程已完成，后续计划取消"),
	deadline: t("到达最晚停止时间，工程未完成，已暂停"),
	manual: t("操作员手动操作，后续计划已停用"),
	canceled: t("计划已取消"),
	start_failed: t("定时启动或恢复失败，计划已停用"),
	missed: t("错过开始时间超过 10 分钟，计划未自动补跑"),
	restart: t("服务重启，计划已停用，等待操作员继续"),
};

const SCHEDULE_ACTION_LABELS: Record<SentinelEngineScheduleAction, string> = {
	start: t("启动"),
	pause: t("暂停"),
	resume: t("恢复"),
	deadline: t("最晚停止"),
};

function browserTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatZonedDateTime(at: number, timezone: string): string {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			hourCycle: "h23",
		}).formatToParts(new Date(at));
		const value = (type: Intl.DateTimeFormatPartTypes): string =>
			parts.find((part) => part.type === type)?.value ?? "";
		return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
	} catch {
		return new Date(at).toLocaleString("zh-CN", { hour12: false });
	}
}

function toLocalInputValue(at: number): string {
	const date = new Date(at);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalInput(value: string): number | null {
	if (!value) return null;
	const at = new Date(value).getTime();
	return Number.isFinite(at) ? at : null;
}

interface ScheduleDraft {
	startAt: string;
	pauseEnabled: boolean;
	pauseAt: string;
	resumeAt: string;
	deadlineEnabled: boolean;
	deadlineAt: string;
}

function emptyScheduleDraft(now = Date.now()): ScheduleDraft {
	const start = now + 30 * 60_000;
	return {
		startAt: toLocalInputValue(start),
		pauseEnabled: false,
		pauseAt: toLocalInputValue(start + 4 * 60 * 60_000),
		resumeAt: toLocalInputValue(start + 8 * 60 * 60_000),
		deadlineEnabled: false,
		deadlineAt: toLocalInputValue(start + 10 * 60 * 60_000),
	};
}

function draftFromSchedule(schedule: SentinelEngineSchedule): ScheduleDraft {
	return {
		startAt: toLocalInputValue(schedule.startAt),
		pauseEnabled: schedule.pauseAt !== null,
		pauseAt: schedule.pauseAt !== null ? toLocalInputValue(schedule.pauseAt) : "",
		resumeAt: schedule.resumeAt !== null ? toLocalInputValue(schedule.resumeAt) : "",
		deadlineEnabled: schedule.deadlineAt !== null,
		deadlineAt: schedule.deadlineAt !== null ? toLocalInputValue(schedule.deadlineAt) : "",
	};
}

function parseScheduleDraft(draft: ScheduleDraft): { schedule?: SentinelEngineScheduleInput; error?: string } {
	const startAt = parseLocalInput(draft.startAt);
	if (startAt === null) return { error: t("请选择开始时间") };
	if (startAt <= Date.now()) return { error: t("开始时间必须晚于当前时间") };
	const pauseAt = draft.pauseEnabled ? parseLocalInput(draft.pauseAt) : null;
	const resumeAt = draft.pauseEnabled ? parseLocalInput(draft.resumeAt) : null;
	if (draft.pauseEnabled && (pauseAt === null || resumeAt === null)) {
		return { error: t("请同时填写暂停时间和恢复时间") };
	}
	if (pauseAt !== null && pauseAt <= startAt) return { error: t("暂停时间必须晚于开始时间") };
	if (pauseAt !== null && resumeAt !== null && resumeAt <= pauseAt) {
		return { error: t("恢复时间必须晚于暂停时间") };
	}
	const deadlineAt = draft.deadlineEnabled ? parseLocalInput(draft.deadlineAt) : null;
	if (draft.deadlineEnabled && deadlineAt === null) return { error: t("请选择最晚停止时间") };
	const lastStep = resumeAt ?? pauseAt ?? startAt;
	if (deadlineAt !== null && deadlineAt <= lastStep) {
		return { error: t("最晚停止时间必须晚于最后一次计划动作") };
	}
	return {
		schedule: {
			timezone: browserTimezone(),
			startAt,
			pauseAt,
			resumeAt,
			deadlineAt,
		},
	};
}

function nextPlanStep(
	schedule: SentinelEngineSchedule,
): { action: SentinelEngineScheduleAction; at: number } | null {
	if (schedule.phase === "finished") return null;
	const candidates: Array<{ action: SentinelEngineScheduleAction; at: number }> = [];
	if (schedule.phase === "waiting_start" && !schedule.applied.includes("start")) {
		candidates.push({ action: "start", at: schedule.startAt });
	}
	if (schedule.phase === "running") {
		if (schedule.pauseAt !== null && !schedule.applied.includes("pause")) {
			candidates.push({ action: "pause", at: schedule.pauseAt });
		}
		if (schedule.deadlineAt !== null && !schedule.applied.includes("deadline")) {
			candidates.push({ action: "deadline", at: schedule.deadlineAt });
		}
	}
	if (schedule.phase === "paused") {
		if (schedule.resumeAt !== null && !schedule.applied.includes("resume")) {
			candidates.push({ action: "resume", at: schedule.resumeAt });
		}
		if (schedule.deadlineAt !== null && !schedule.applied.includes("deadline")) {
			candidates.push({ action: "deadline", at: schedule.deadlineAt });
		}
	}
	return candidates.sort((left, right) => left.at - right.at)[0] ?? null;
}

function formatRemaining(at: number, now: number): string {
	const delta = at - now;
	if (delta <= 0) return t("即将执行");
	const minutes = Math.ceil(delta / 60_000);
	if (minutes < 60) return t("{minutes} 分钟后", { minutes });
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest > 0
		? t("{hours} 小时 {rest} 分钟后", { hours, rest })
		: t("{hours} 小时后", { hours });
}

export interface EnginePageProps {
	engines: SentinelEngine[];
	doctrines: SentinelDoctrineView[];
	/** Enabled presets the commander may dispatch with, for the whitelist controls. */
	presets: SentinelPresetView[];
	onSend: (message: unknown) => void;
	onError: (message: string) => void;
	commanderEvents: Record<string, SentinelSubagentEvent[]>;
	taskEvents: Record<string, SentinelSubagentEvent[]>;
	onOpenTaskEvents: (taskId: string) => void;
	onOpenCommanderEvents: (engineId: string) => void;
	hasProject: boolean;
	/** Whether a judge endpoint resolves, so the create form can offer AI 裁判. */
	judgeAvailable: boolean;
}

type View = "list" | "board" | "create" | "doctrines";

export function EnginePage(props: EnginePageProps) {
	const [view, setView] = useState<View>("list");
	const [boardId, setBoardId] = useState<string | null>(null);
	const [openTaskId, setOpenTaskId] = useState<string | null>(null);
	const [report, setReport] = useState<{ markdown: string; filename: string } | null>(null);
	const [editingSchedule, setEditingSchedule] = useState(false);

	const board = useMemo(() => props.engines.find((engine) => engine.id === boardId) ?? null, [props.engines, boardId]);
	const scheduleActive = !!board?.schedule && board.schedule.phase !== "finished";
	useEffect(() => {
		if (board?.status !== "scheduled") setEditingSchedule(false);
	}, [board?.status]);

	const openBoard = (id: string) => {
		setBoardId(id);
		setView("board");
	};

	// Poll the persisted commander log while a board is open. Live events are
	// pushed over the socket too, but a missed frame (or a handler still awaiting
	// a commander turn) must not leave the conversation invisible until refresh.
	const openEventsRef = useRef(props.onOpenCommanderEvents);
	openEventsRef.current = props.onOpenCommanderEvents;
	useEffect(() => {
		if (view !== "board" || !boardId) return;
		const load = (): void => openEventsRef.current(boardId);
		load();
		const timer = window.setInterval(load, 3000);
		return () => window.clearInterval(timer);
	}, [view, boardId]);

	const send = props.onSend;

	if (view === "create") {
		return (
			<div className="ui-page enginewiz-page">
				<CreateEngineForm
					doctrines={props.doctrines}
					presets={props.presets}
					hasProject={props.hasProject}
					judgeAvailable={props.judgeAvailable}
					onCancel={() => setView("list")}
					onSubmit={(input) => {
						send({ type: "engine_create", input });
						setView("list");
					}}
				/>
			</div>
		);
	}

	if (view === "doctrines") {
		return (
			<DoctrineManager
				doctrines={props.doctrines}
				onClose={() => setView("list")}
				onSave={(input) => send({ type: "save_doctrine", input })}
				onDelete={(id) => send({ type: "delete_doctrine", id })}
			/>
		);
	}

	if (view === "board" && board) {
		const scheduled = board.status === "scheduled";
		const running = board.status === "running";
		const paused = board.status === "paused";
		const active = running || paused;
		const elapsedText = board.startedAt !== null
			? board.endedAt
				? t(" · 历时 {duration}", { duration: formatDuration(board.endedAt - board.startedAt) })
				: running
					? t(" · 已运行 {duration}", { duration: formatDuration(Date.now() - board.startedAt) })
					: ""
			: t(" · 尚未启动");

		return (
			<Page
				title={
					<Space size={8} wrap>
						<Button size="small" onClick={() => setView("list")}>
							{t("← 返回")}
						</Button>
						{board.name}
						<Tag color={ENGINE_STATUS_COLORS[board.status]} variant="filled">
							{ENGINE_STATUS_LABELS[board.status]}
						</Tag>
					</Space>
				}
				description={`${board.projectName}${t(" · 创建于 {time}", {
					time: new Date(board.createdAt).toLocaleString("zh-CN", { hour12: false }),
				})}${elapsedText}`}
				extra={
					<Space size={6} wrap>
						<Button size="small" onClick={() => send({ type: "engine_report_snapshot", id: board.id })}>
							{t("进度快照")}
						</Button>
						{board.report ? (
							<Button
								size="small"
								onClick={() =>
									setReport({
										markdown: board.report ?? "",
										filename: t("{name}-总报告.md", { name: board.name }),
									})
								}
							>
								{t("查看总报告")}
							</Button>
						) : null}
						{scheduled ? (
							<Button size="small" onClick={() => setEditingSchedule(true)}>
								{t("修改计划")}
							</Button>
						) : null}
						{scheduled ? (
							<Popconfirm
								title={t("取消计划")}
								description={t("取消后计划不再执行，工程会标记为已终止。确定取消？")}
								okText={t("取消计划")}
								okButtonProps={{ danger: true }}
								cancelText={t("返回")}
								onConfirm={() => send({ type: "engine_cancel_schedule", id: board.id })}
							>
								<Button size="small" danger>
									{t("取消计划")}
								</Button>
							</Popconfirm>
						) : null}
						{scheduleActive && !scheduled ? (
							<Popconfirm
								title={t("停用计划")}
								description={t("停用后续定时计划？当前运行不会停止。")}
								okText={t("停用")}
								cancelText={t("返回")}
								onConfirm={() => send({ type: "engine_cancel_schedule", id: board.id })}
							>
								<Button size="small">{t("停用计划")}</Button>
							</Popconfirm>
						) : null}
						{running ? (
							<Button
								size="small"
								onClick={() => {
									if (scheduleActive && !window.confirm(t("手动暂停会停用后续定时计划，确定？"))) return;
									send({ type: "engine_pause", id: board.id });
								}}
							>
								{t("暂停")}
							</Button>
						) : null}
						{paused ? (
							<Button
								size="small"
								type="primary"
								onClick={() => {
									if (scheduleActive && !window.confirm(t("手动继续会停用后续定时计划，确定？"))) return;
									send({ type: "engine_resume", id: board.id });
								}}
							>
								{t("继续")}
							</Button>
						) : null}
						{active ? (
							<Popconfirm
								title={t("终止工程")}
								description={scheduleActive ? t("终止会同时停用后续定时计划，确定？") : t("终止后当前任务会停止。确定？")}
								okText={t("终止")}
								okButtonProps={{ danger: true }}
								cancelText={t("返回")}
								onConfirm={() => send({ type: "engine_abort", id: board.id })}
							>
								<Button size="small" danger>
									{t("终止")}
								</Button>
							</Popconfirm>
						) : (
							<Popconfirm
								title={t("删除工程")}
								description={t("删除工程「{name}」？任务记录将一并删除。", { name: board.name })}
								okText={t("删除")}
								okButtonProps={{ danger: true }}
								cancelText={t("返回")}
								onConfirm={() => {
									send({ type: "engine_delete", id: board.id });
									setView("list");
								}}
							>
								<Button size="small" danger>
									{t("删除")}
								</Button>
							</Popconfirm>
						)}
					</Space>
				}
			>
				<div className="ws-panel__body">
					{board.schedule ? <ScheduleStrip schedule={board.schedule} /> : null}
					<EngineStats
						engine={board}
						judgeAvailable={props.judgeAvailable}
						onSetGateMode={(gateMode) => send({ type: "engine_set_gate_mode", id: board.id, gateMode })}
					/>
					<EnginePresetWhitelist
						engine={board}
						presets={props.presets}
						onChange={(presetIds) => send({ type: "engine_set_presets", id: board.id, presetIds })}
						onChangeOptional={(optional) => send({ type: "engine_set_preset_optional", id: board.id, optional })}
					/>
					{(board.status === "running" || board.status === "paused") && (
						<TargetsBox engineId={board.id} onSend={send} />
					)}
					<div className="board">
						<TaskBoard
							engine={board}
							onOpenTask={(taskId) => {
								setOpenTaskId(taskId);
								props.onOpenTaskEvents(taskId);
							}}
							onAbortTask={(taskId) => send({ type: "engine_abort_task", taskId })}
						/>
						<CommanderFeed
							engineId={board.id}
							running={board.status === "running"}
							completed={board.status === "completed"}
							events={props.commanderEvents[board.id] ?? []}
							onSend={send}
						/>
					</div>
				</div>
				{openTaskId ? (
					<TaskModal
						task={board.tasks.find((task) => task.id === openTaskId) ?? null}
						events={props.taskEvents[openTaskId] ?? []}
						onClose={() => setOpenTaskId(null)}
						onAbort={(taskId) => send({ type: "engine_abort_task", taskId })}
						onOpenInChat={(taskId) => {
							send({ type: "engine_open_task_session", taskId });
							setOpenTaskId(null);
						}}
					/>
				) : null}
				{editingSchedule && board.schedule ? (
					<ScheduleModal
						schedule={board.schedule}
						onClose={() => setEditingSchedule(false)}
						onSave={(schedule) => {
							send({ type: "engine_set_schedule", id: board.id, schedule });
							setEditingSchedule(false);
						}}
					/>
				) : null}
				<Modal
					open={report !== null}
					title={report?.filename}
					width={880}
					onCancel={() => setReport(null)}
					footer={
						<Space size={8}>
							<Button onClick={() => void navigator.clipboard.writeText(report?.markdown ?? "")}>
								{t("复制")}
							</Button>
							<Button type="primary" onClick={() => setReport(null)}>
								{t("关闭")}
							</Button>
						</Space>
					}
				>
					<pre className="report-preview">{report?.markdown ?? ""}</pre>
				</Modal>
			</Page>
		);
	}

	// list view
	const columns: ProColumns<SentinelEngine>[] = [
		{
			title: t("工程"),
			dataIndex: "name",
			key: "name",
			render: (_, engine) => <Text strong>{engine.name}</Text>,
		},
		{
			title: t("状态"),
			key: "status",
			width: 120,
			render: (_, engine) => (
				<Tag color={ENGINE_STATUS_COLORS[engine.status]} variant="filled">
					{ENGINE_STATUS_LABELS[engine.status]}
				</Tag>
			),
		},
		{
			title: t("进度"),
			key: "progress",
			render: (_, engine) => {
				const running = engine.tasks.filter((task) => task.status === "running").length;
				const queued = engine.tasks.filter((task) => task.status === "queued").length;
				const done = engine.tasks.filter((task) => task.status === "done").length;
				const failed = engine.tasks.filter((task) => ["failed", "blocked"].includes(task.status)).length;
				const parts = [
					t("{count} 完成", { count: done }),
					running > 0 ? t("{count} 运行", { count: running }) : "",
					queued > 0 ? t("{count} 排队", { count: queued }) : "",
					failed > 0 ? t("{count} 失败", { count: failed }) : "",
				].filter(Boolean);
				return <Text type="secondary">{parts.join(" · ") || "—"}</Text>;
			},
		},
		{
			title: t("中枢提交"),
			key: "vulns",
			width: 110,
			render: (_, engine) => (
				<Text>{t("{count} 条", { count: engine.tasks.reduce((sum, task) => sum + task.vulns, 0) })}</Text>
			),
		},
		{
			title: t("耗时"),
			key: "elapsed",
			width: 110,
			render: (_, engine) => {
				const startedAt = engine.startedAt ?? engine.createdAt;
				const elapsed =
					engine.startedAt === null
						? null
						: (engine.endedAt ?? (engine.status === "running" ? Date.now() : startedAt)) - startedAt;
				return <Text type="secondary">{elapsed === null ? "—" : formatDuration(elapsed)}</Text>;
			},
		},
		{
			title: t("创建时间"),
			key: "createdAt",
			width: 170,
			render: (_, engine) => (
				<Text type="secondary">{new Date(engine.createdAt).toLocaleString("zh-CN", { hour12: false })}</Text>
			),
		},
	];

	return (
		<Page
			title={t("工程")}
			description={
				props.hasProject
					? t("{project} · {count} 个工程", {
							project: props.engines[0]?.projectName ?? "",
							count: props.engines.length,
						})
					: t("请先选择项目")
			}
			extra={
				<Space size={8}>
					<Button icon={<ReadOutlined />} onClick={() => setView("doctrines")}>
						{t("指挥思路")}
					</Button>
					<Button type="primary" icon={<PlusOutlined />} disabled={!props.hasProject} onClick={() => setView("create")}>
						{t("新建工程")}
					</Button>
				</Space>
			}
		>
			<ProTable<SentinelEngine>
				rowKey="id"
				size="small"
				columns={columns}
				dataSource={props.engines}
				search={false}
				options={false}
				pagination={false}
				onRow={(engine) => ({
					onClick: () => openBoard(engine.id),
					style: { cursor: "pointer" },
				})}
				locale={{
					emptyText: props.hasProject
						? t("还没有工程。点「新建工程」，贴入目标清单并选择指挥思路即可开始。")
						: t("工程属于项目：请先在侧栏顶部选择或创建一个项目。"),
				}}
			/>
		</Page>
	);
}

function EngineStats({
	engine,
	judgeAvailable,
	onSetGateMode,
}: {
	engine: SentinelEngine;
	judgeAvailable: boolean;
	onSetGateMode: (mode: SentinelEngineGateMode) => void;
}) {
	const count = (status: SentinelEngineTaskStatus) => engine.tasks.filter((task) => task.status === status).length;
	const vulns = engine.tasks.reduce((sum, task) => sum + task.vulns, 0);
	// The server refuses a change while a worker is in flight, because each task
	// session captures its gate when it is created.
	const busy = engine.tasks.some((task) => task.status === "running" || task.status === "queued");
	const gateLockedReason = busy ? t("有任务正在运行或排队，等它们结束再改") : undefined;
	return (
		<Card size="small" className="enginehub-stats">
			<Space size={8} wrap>
				<Tag color="processing" variant="filled">
					{t("运行 {count}", { count: count("running") })}
				</Tag>
				<Tag variant="filled">{t("排队 {count}", { count: count("queued") })}</Tag>
				<Tag color="success" variant="filled">
					{t("完成 {count}", { count: count("done") })}
				</Tag>
				<Tag color="error" variant="filled">
					{t("失败 {count}", { count: count("failed") })}
				</Tag>
				<Tag color="warning" variant="filled">
					{t("阻塞 {count}", { count: count("blocked") })}
				</Tag>
				<Text type="secondary">
					{t("· 中枢提交")} <Text strong>{vulns}</Text> {t("条")}
				</Text>
				<Text type="secondary">
					{t("· 并发")} <Text strong>{engine.limits.concurrency}</Text>
				</Text>
				<Text type="secondary">
					{t("轮数")} <Text strong>{engine.limits.roundLimit}</Text>
				</Text>
				<Text type="secondary">
					{t("重试")} <Text strong>{engine.limits.maxRetries}</Text>
				</Text>
				{engine.limits.tokenLimit ? (
					<Text type="secondary">
						{t("token 上限")} <Text strong>{formatUsage(engine.limits.tokenLimit)}</Text>
					</Text>
				) : null}
				{engine.limits.timeLimitMin ? (
					<Text type="secondary">
						{t("时间上限")}{" "}
						<Text strong>
							{engine.limits.timeLimitMin} {t("分")}
						</Text>
					</Text>
				) : null}
				<Segmented
					size="small"
					value={engine.gateMode}
					disabled={busy}
					title={gateLockedReason ?? t("worker 命令的守门方式")}
					onChange={(value) => onSetGateMode(value as SentinelEngineGateMode)}
					options={[
						{ value: "auto", label: t("自动执行") },
						{ value: "ai", label: t("AI 裁判"), disabled: !judgeAvailable },
					]}
				/>
				{engine.pauseNote ? <Text type="secondary">{engine.pauseNote}</Text> : null}
			</Space>
		</Card>
	);
}

/**
 * The engine's preset whitelist, and whether a task may go without one. Unlike the
 * gate mode both stay editable while the engine runs, because they only narrow what
 * the commander may pick for the tasks it has not dispatched yet.
 */
function EnginePresetWhitelist({
	engine,
	presets,
	onChange,
	onChangeOptional,
}: {
	engine: SentinelEngine;
	presets: SentinelPresetView[];
	onChange(presetIds: string[]): void;
	onChangeOptional(optional: boolean): void;
}) {
	const enabled = presets.filter((preset) => preset.enabled);
	const selected = engine.presetIds;
	const allowed =
		selected.length === 0 ? enabled.length : selected.filter((id) => enabled.some((p) => p.id === id)).length;
	// A required preset with nothing to pick from cannot dispatch at all: the
	// commander would be refused on every attempt.
	const stuck = !engine.presetOptional && allowed === 0;
	return (
		<Card
			size="small"
			title={t("预设 Agent 白名单")}
			extra={
				<Tag color={selected.length === 0 ? "green" : undefined} variant="filled">
					{selected.length === 0
						? t("未限制：指挥官可使用全部已启用的预设")
						: t("已限制为 {count} 个预设", { count: selected.length })}
				</Tag>
			}
		>
			<Text type="secondary">
				{t("勾选指挥官可以使用的预设；未勾选任何一项 = 不限制（指挥官可用全部已启用的预设）。")}{" "}
				{t("运行中也能修改，只影响之后派发的任务；已停用或已删除的预设不会出现在上面，也不会再被派发。")}
			</Text>
			{enabled.length === 0 ? (
				<Alert
					type="info"
					showIcon
					className="ui-page__alert"
					title={t("还没有启用的预设 Agent，可到 设置 → 预设 Agent 创建。")}
				/>
			) : (
				<Space orientation="vertical" size={6} className="enginehub-presets">
					{enabled.map((preset) => (
						<Checkbox
							key={preset.id}
							checked={selected.includes(preset.id)}
							title={preset.description || undefined}
							onChange={(event) =>
								onChange(
									event.target.checked
										? [...selected, preset.id]
										: selected.filter((id) => id !== preset.id),
								)
							}
						>
							<Space size={8} wrap>
								<Text>{preset.name}</Text>
								<Text type="secondary">{t("粗估 {count} tokens", { count: preset.tokens })}</Text>
							</Space>
						</Checkbox>
					))}
				</Space>
			)}
			<Checkbox
				checked={engine.presetOptional}
				className="enginehub-optional"
				onChange={(event) => onChangeOptional(event.target.checked)}
			>
				{t("允许任务不指定预设（没有合适预设时，指挥官可以省略 preset，让任务用默认 Agent 执行）")}
			</Checkbox>
			<Alert
				type={stuck ? "warning" : "info"}
				showIcon
				className="ui-page__alert"
				title={
					engine.presetOptional
						? t("关掉它，指挥官就必须为每个任务指定一个预设；没有合适的时候也不能退回默认 Agent，派发会被拒绝。")
						: stuck
							? t("已要求每个任务都必须指定预设，但当前没有可用预设：指挥官无法派发任何任务，请勾选上面的预设，或重新允许使用默认 Agent。")
							: t("已要求每个任务都必须指定预设（当前可选 {count} 个）；省略 preset 的派发会被拒绝，不会产生任务。", {
									count: allowed,
								})
				}
			/>
		</Card>
	);
}

function TargetsBox({ engineId, onSend }: { engineId: string; onSend: (message: unknown) => void }) {
	const [appendText, setAppendText] = useState("");
	return (
		<div className="enginehub-targets">
			<Space.Compact style={{ width: "100%" }}>
				<Input
					placeholder={t("追加目标（一行一个，可带备注）…")}
					value={appendText}
					onChange={(event) => setAppendText(event.target.value)}
				/>
				<Button
					type="primary"
					disabled={!appendText.trim()}
					onClick={() => {
						onSend({ type: "engine_add_targets", id: engineId, targets: appendText });
						setAppendText("");
					}}
				>
					{t("追加")}
				</Button>
			</Space.Compact>
		</div>
	);
}

function TaskBoard(props: { engine: SentinelEngine; onOpenTask(taskId: string): void; onAbortTask(taskId: string): void }) {
	const tasks = props.engine.tasks;
	return (
		<Card size="small" className="enginehub-board">
			<ProTable<SentinelEngineTask>
				rowKey="id"
				size="small"
				dataSource={tasks}
				search={false}
				options={false}
				pagination={false}
				scroll={{ x: 820 }}
				toolbar={{
					title: <Text strong>{t("任务看板")}</Text>,
					actions: [
						<Text key="count" type="secondary">
							{t("{count} 个任务 · 点行看详情", { count: tasks.length })}
						</Text>,
					],
				}}
				onRow={(task) => ({
					onClick: () => props.onOpenTask(task.id),
					style: { cursor: "pointer" },
				})}
				columns={[
					{
						title: t("状态"),
						key: "status",
						width: 100,
						render: (_, task) => (
							<Tag
								color={
									task.status === "done"
										? "green"
										: task.status === "failed" || task.status === "blocked"
											? "red"
											: task.status === "running"
												? "processing"
												: "default"
								}
								variant="filled"
							>
								{TASK_STATUS_LABELS[task.status]}
							</Tag>
						),
					},
					{
						title: t("任务"),
						key: "title",
						render: (_, task) => (
							<div className="enginehub-task">
								<Text strong>{task.title}</Text>
								<Tag
									variant="filled"
									title={
										task.presetName
											? t("预设 Agent：{name}", { name: task.presetName })
											: t("默认 Agent：未指定预设")
									}
								>
									{task.presetName ?? t("默认")}
								</Tag>
							</div>
						),
					},
					{
						title: t("目标"),
						key: "target",
						width: 160,
						render: (_, task) => <Text code>{task.target ?? "—"}</Text>,
					},
					{
						title: t("次数"),
						key: "attempt",
						width: 80,
						render: (_, task) => t("第 {count} 次", { count: task.attempt }),
					},
					{
						title: t("用量"),
						key: "usage",
						width: 90,
						render: (_, task) => <Text type="secondary">{formatUsage(task.usage?.total)}</Text>,
					},
					{
						title: t("结论"),
						key: "summary",
						ellipsis: true,
						render: (_, task) => <Text type="secondary">{task.summary ?? task.error ?? ""}</Text>,
					},
					{
						title: "",
						key: "ops",
						width: 90,
						render: (_, task) =>
							task.status === "running" || task.status === "queued" ? (
								<Button
									size="small"
									type="link"
									danger
									onClick={(event) => {
										event.stopPropagation();
										props.onAbortTask(task.id);
									}}
								>
									{t("中止")}
								</Button>
							) : null,
					},
				]}
				locale={{
					emptyText: (
						<Empty
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={
								props.engine.status === "scheduled"
									? t("计划等待开始。到点后先检查运行环境，再启动指挥官并派发任务。")
									: t("还没有任务。指挥官启动后会在这里派发。")
							}
						/>
					),
				}}
			/>
		</Card>
	);
}

/** Tool-call summary for one feed row: name plus the most useful argument. */
function toolArgSummary(event: SentinelSubagentEvent): string {
	const args = (event.args ?? {}) as Record<string, unknown>;
	for (const key of ["title", "task_id", "instruction", "reason"]) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	const text = JSON.stringify(args);
	return text === "{}" ? "" : text;
}

function CommanderFeed({
	engineId,
	running,
	completed,
	events,
	onSend,
}: {
	engineId: string;
	running: boolean;
	completed: boolean;
	events: SentinelSubagentEvent[];
	onSend: (message: unknown) => void;
}) {
	const canChat = running || completed;
	const [draft, setDraft] = useState("");
	const sendDraft = (): void => {
		const text = draft.trim();
		if (!text || !canChat) return;
		onSend({ type: "engine_steer_commander", id: engineId, text });
		setDraft("");
	};
	return (
		<Card
			size="small"
			className="enginehub-feed"
			title={t("指挥官")}
			extra={<Text type="secondary">{t("对话 · 决策日志")}</Text>}
		>
			<div className="enginehub-feed__body">
				{events.length === 0 ? (
					<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("指挥官还没有动作。")} />
				) : null}
				{events.map((event) => {
					if (event.kind === "thinking") {
						return (
							<Collapse
								key={event.seq}
								ghost
								size="small"
								className="enginehub-thinking"
								items={[
									{
										key: String(event.seq),
										label: (
											<Text type="secondary">
												{t("{time} · 思考 · {count} 字", {
													time: formatClock(event.at),
													count: (event.text ?? "").length,
												})}
											</Text>
										),
										children: <pre className="enginehub-pre">{event.text}</pre>,
									},
								]}
							/>
						);
					}
					if (event.kind === "text" && event.from === "operator") {
						return (
							<div key={event.seq} className="enginehub-msg is-operator">
								<Text type="secondary" className="enginehub-msg__meta">
									{t("你 · {time}", { time: formatClock(event.at) })}
								</Text>
								<Text className="enginehub-msg__text">{event.text}</Text>
							</div>
						);
					}
					if (event.kind === "text") {
						return (
							<div key={event.seq} className="enginehub-msg">
								<Text type="secondary" className="enginehub-msg__meta">
									{t("{time} · 指挥官", { time: formatClock(event.at) })}
								</Text>
								<Text className="enginehub-msg__text">{event.text}</Text>
							</div>
						);
					}
					if (event.kind === "tool_start") {
						return (
							<div key={event.seq} className="enginehub-tool">
								<Text type="secondary">{formatClock(event.at)}</Text>
								<Text code>{event.toolName}</Text>
								<Text type="secondary" ellipsis>
									{toolArgSummary(event)}
								</Text>
							</div>
						);
					}
					if (event.kind === "tool_end") {
						return (
							<div key={event.seq} className="enginehub-tool">
								<Text type="secondary">{formatClock(event.at)}</Text>
								<Tag color={event.isError ? "red" : "green"} variant="filled">
									{event.toolName}
								</Tag>
								<Text type="secondary" ellipsis>
									{(event.output ?? "").trim().slice(0, 200)}
								</Text>
							</div>
						);
					}
					if (event.kind === "status") {
						return (
							<Text key={event.seq} type="secondary" className="enginehub-status">
								{event.note ?? event.status ?? ""}
							</Text>
						);
					}
					return null;
				})}
			</div>
			<div className="enginehub-composer">
				<Input.TextArea
					rows={2}
					value={draft}
					disabled={!canChat}
					placeholder={
						running
							? t("和指挥官对话…Enter 发送，Shift+Enter 换行")
							: completed
								? t("工程已完成，向指挥官追问报告细节…")
								: t("工程未运行，暂时不能对话")
					}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							sendDraft();
						}
					}}
				/>
				<Button type="primary" disabled={!canChat || !draft.trim()} onClick={sendDraft}>
					{t("发送")}
				</Button>
			</div>
		</Card>
	);
}

function TaskModal(props: {
	task: SentinelEngineTask | null;
	events: SentinelSubagentEvent[];
	onClose(): void;
	onAbort(taskId: string): void;
	onOpenInChat(taskId: string): void;
}) {
	const task = props.task;
	if (!task) return null;
	return (
		<Modal
			open
			width={880}
			onCancel={props.onClose}
			footer={null}
			destroyOnHidden
			className="engine-task-modal"
			title={
				<Space size={8} wrap>
					<Text strong>{task.title}</Text>
					<Tag color={task.status === "done" ? "green" : task.status === "failed" ? "red" : "processing"} variant="filled">
						{TASK_STATUS_LABELS[task.status]}
					</Tag>
				</Space>
			}
		>
			<Space size={8} wrap className="enginehub-taskops">
				{task.sessionId ? (
					<Button size="small" onClick={() => props.onOpenInChat(task.id)}>
						{t("在对话中打开")}
					</Button>
				) : null}
				{task.status === "running" || task.status === "queued" ? (
					<Button size="small" danger onClick={() => props.onAbort(task.id)}>
						{t("中止任务")}
					</Button>
				) : null}
				<Button size="small" type="primary" onClick={props.onClose}>
					{t("关闭")}
				</Button>
			</Space>

			<Descriptions
				size="small"
				column={2}
				bordered
				className="enginehub-taskdesc"
				items={[
					{ key: "target", label: t("目标"), children: task.target ?? "—" },
					{ key: "preset", label: t("预设 Agent"), children: task.presetName ?? t("默认 Agent") },
					{ key: "attempt", label: t("派发次数"), children: t("第 {count} 次", { count: task.attempt }) },
					{ key: "workspace", label: t("工作目录"), children: <Text code>/work/tasks/{task.workspace}</Text> },
					{ key: "rounds", label: t("轮数上限"), children: task.roundLimit },
					{ key: "tokens", label: t("用量"), children: `${formatUsage(task.usage?.total)} tokens` },
					{
						key: "elapsed",
						label: t("耗时"),
						children: task.startedAt ? formatDuration((task.endedAt ?? Date.now()) - task.startedAt) : "—",
					},
					{ key: "vulns", label: t("中枢提交"), children: t("{count} 条", { count: task.vulns }) },
				]}
			/>

			<Text strong>{task.status === "running" ? t("当前结论") : t("结论")}</Text>
			{task.error ? <Alert type="error" showIcon className="ui-page__alert" title={task.error} /> : null}
			<pre className="enginehub-pre">{task.summary ?? t("（暂无）")}</pre>

			<Text strong>{t("任务指令（指挥官原文）")}</Text>
			<pre className="enginehub-pre">{task.objective}</pre>

			<Text strong>{t("执行过程 · {count} 步", { count: props.events.length })}</Text>
			<div className="enginehub-events">
				{props.events.slice(-30).map((event) => (
					<div key={event.seq} className="enginehub-event">
						<Space size={8} wrap>
							<Text type="secondary">{formatClock(event.at)}</Text>
							{event.kind === "text" ? (
								<Text>{(event.text ?? "").slice(0, 160)}</Text>
							) : event.kind === "thinking" ? (
								<Text type="secondary">{t("思考 · {count} 字", { count: (event.text ?? "").length })}</Text>
							) : event.kind === "tool_start" ? (
								<Text code>{event.toolName}</Text>
							) : event.kind === "tool_end" ? (
								<Tag color={event.isError ? "red" : "green"} variant="filled">
									{event.toolName}
								</Tag>
							) : (
								<Text type="secondary">{event.note ?? event.status ?? ""}</Text>
							)}
						</Space>
						{event.kind === "tool_end" && (event.output ?? "").trim() ? (
							<pre className="enginehub-pre">{event.output}</pre>
						) : null}
					</div>
				))}
			</div>
		</Modal>
	);
}

function ScheduleStrip({ schedule }: { schedule: SentinelEngineSchedule }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (schedule.phase === "finished") return;
		const timer = window.setInterval(() => setNow(Date.now()), 15_000);
		return () => window.clearInterval(timer);
	}, [schedule.phase]);
	const next = nextPlanStep(schedule);
	const steps: Array<{ action: SentinelEngineScheduleAction; at: number }> = [
		{ action: "start", at: schedule.startAt },
	];
	if (schedule.pauseAt !== null) steps.push({ action: "pause", at: schedule.pauseAt });
	if (schedule.resumeAt !== null) steps.push({ action: "resume", at: schedule.resumeAt });
	if (schedule.deadlineAt !== null) steps.push({ action: "deadline", at: schedule.deadlineAt });
	const phaseColor =
		schedule.phase === "running"
			? "processing"
			: schedule.phase === "paused"
				? "warning"
				: schedule.phase === "finished"
					? "default"
					: "blue";
	return (
		<Card
			size="small"
			className="enginehub-schedule"
			title={
				<Space size={8} wrap>
					<Text strong>{t("定时计划")}</Text>
					<Tag color={phaseColor} variant="filled">
						{SCHEDULE_PHASE_LABELS[schedule.phase]}
					</Tag>
					<Text type="secondary">{schedule.timezone}</Text>
				</Space>
			}
		>
			<Text type="secondary">
				{next
					? t("下次{action} {time}（{remaining}）", {
							action: SCHEDULE_ACTION_LABELS[next.action],
							time: formatZonedDateTime(next.at, schedule.timezone),
							remaining: formatRemaining(next.at, now),
						})
					: schedule.phase === "running"
						? t("无后续计划动作，运行至工程完成")
						: schedule.phase === "finished"
							? SCHEDULE_FINISH_LABELS[schedule.finishedReason ?? "manual"]
							: ""}
			</Text>
			<Space size={16} wrap className="enginehub-schedule__steps">
				{steps.map((step) => {
					const done = schedule.applied.includes(step.action);
					const current = next?.action === step.action;
					return (
						<Space key={step.action} size={6}>
							<Tag color={done ? "green" : current ? "processing" : "default"} variant="filled">
								{done ? "✓" : current ? "→" : "·"}
							</Tag>
							<Text>{SCHEDULE_ACTION_LABELS[step.action]}</Text>
							<Text type="secondary">{formatZonedDateTime(step.at, schedule.timezone)}</Text>
						</Space>
					);
				})}
			</Space>
		</Card>
	);
}

function ScheduleFields({
	draft,
	onChange,
	timezone,
}: {
	draft: ScheduleDraft;
	onChange: (next: ScheduleDraft) => void;
	timezone: string;
}) {
	const set = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]): void =>
		onChange({ ...draft, [key]: value });
	const lastStep = draft.resumeAt || draft.pauseAt || draft.startAt;
	return (
		<Form layout="vertical" requiredMark={false} className="enginehub-scheduleform">
			<Row gutter={12}>
				<Col xs={24} md={12}>
					<Form.Item label={t("开始时间")}>
						<Input
							type="datetime-local"
							value={draft.startAt}
							min={toLocalInputValue(Date.now())}
							onChange={(event) => set("startAt", event.target.value)}
						/>
					</Form.Item>
				</Col>
				<Col xs={24} md={12}>
					<Form.Item label={t("时区")}>
						<Text type="secondary">{t("{timezone}（浏览器时区）", { timezone })}</Text>
					</Form.Item>
				</Col>
			</Row>
			<Checkbox checked={draft.pauseEnabled} onChange={(event) => set("pauseEnabled", event.target.checked)}>
				{t("中途暂停，并在指定时间自动恢复")}
			</Checkbox>
			{draft.pauseEnabled ? (
				<Row gutter={12} className="enginehub-scheduleform__row">
					<Col xs={24} md={12}>
						<Form.Item label={t("暂停时间")}>
							<Input
								type="datetime-local"
								value={draft.pauseAt}
								min={draft.startAt}
								onChange={(event) => set("pauseAt", event.target.value)}
							/>
						</Form.Item>
					</Col>
					<Col xs={24} md={12}>
						<Form.Item label={t("恢复时间")}>
							<Input
								type="datetime-local"
								value={draft.resumeAt}
								min={draft.pauseAt || draft.startAt}
								onChange={(event) => set("resumeAt", event.target.value)}
							/>
						</Form.Item>
					</Col>
				</Row>
			) : null}
			<Checkbox checked={draft.deadlineEnabled} onChange={(event) => set("deadlineEnabled", event.target.checked)}>
				{t("设置最晚停止时间；到点未完成则暂停，等待操作员决定")}
			</Checkbox>
			{draft.deadlineEnabled ? (
				<Form.Item label={t("最晚停止时间")} className="enginehub-scheduleform__row">
					<Input
						type="datetime-local"
						value={draft.deadlineAt}
						min={lastStep}
						onChange={(event) => set("deadlineAt", event.target.value)}
					/>
				</Form.Item>
			) : null}
			<Text type="secondary">
				{t("到点暂停会立即中断正在运行的 Agent，保留会话，恢复时自动续跑。服务重启会暂停工程并停用计划，需要操作员手动继续。")}
			</Text>
		</Form>
	);
}

function ScheduleModal({
	schedule,
	onClose,
	onSave,
}: {
	schedule: SentinelEngineSchedule;
	onClose: () => void;
	onSave: (schedule: SentinelEngineScheduleInput) => void;
}) {
	const [draft, setDraft] = useState(() => draftFromSchedule(schedule));
	const [error, setError] = useState<string | null>(null);
	return (
		<Modal
			open
			width={720}
			title={t("修改定时计划")}
			okText={t("保存计划")}
			cancelText={t("取消")}
			onCancel={onClose}
			destroyOnHidden
			onOk={() => {
				const parsed = parseScheduleDraft(draft);
				if (!parsed.schedule) {
					setError(parsed.error ?? t("计划无效"));
					return;
				}
				onSave(parsed.schedule);
			}}
		>
			{error ? <Alert type="error" showIcon className="ui-page__alert" title={error} /> : null}
			<ScheduleFields
				draft={draft}
				onChange={(next) => {
					setDraft(next);
					setError(null);
				}}
				timezone={browserTimezone()}
			/>
		</Modal>
	);
}

function CreateEngineForm(props: {
	doctrines: SentinelDoctrineView[];
	presets: SentinelPresetView[];
	hasProject: boolean;
	/** Whether a judge endpoint resolves; `ai` is only offered when it does. */
	judgeAvailable: boolean;
	onCancel(): void;
	onSubmit(input: {
		name: string;
		targets: string;
		doctrines: string[];
		presetIds: string[];
		presetOptional: boolean;
		limits: SentinelEngineLimits;
		gateMode: SentinelEngineGateMode;
		schedule?: SentinelEngineScheduleInput;
	}): void;
}) {
	type WizardStep = 1 | 2 | 3;
	const [step, setStep] = useState<WizardStep>(1);
	const [name, setName] = useState("");
	const [targets, setTargets] = useState("");
	const [selected, setSelected] = useState<string[]>(props.doctrines.length === 1 ? [props.doctrines[0].id] : []);
	/** Preset whitelist; empty means "no restriction" and is the default. */
	const [selectedPresets, setSelectedPresets] = useState<string[]>([]);
	/** A task may run without a preset; allowing it is the default. */
	const [presetOptional, setPresetOptional] = useState(true);
	const [concurrency, setConcurrency] = useState(3);
	const [roundLimit, setRoundLimit] = useState(5);
	const [maxRetries, setMaxRetries] = useState(1);
	const [tokenLimit, setTokenLimit] = useState("");
	const [timeLimitMin, setTimeLimitMin] = useState("");
	const [gateMode, setGateMode] = useState<SentinelEngineGateMode>("auto");
	const [startMode, setStartMode] = useState<"now" | "scheduled">("now");
	const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() => emptyScheduleDraft());
	const [formError, setFormError] = useState<string | null>(null);

	const enabledPresets = props.presets.filter((preset) => preset.enabled);
	const stepMeta = [
		{ step: 1 as const, title: t("目标"), hint: t("范围与名称") },
		{ step: 2 as const, title: t("指挥"), hint: t("思路与 Agent") },
		{ step: 3 as const, title: t("执行"), hint: t("时间与上限") },
	];
	const selectedPresetLabel =
		selectedPresets.length === 0
			? t("Agent 不限制")
			: t("{count} 个 Agent 预设", { count: selectedPresets.length });

	/** Validation is per step so "下一步" never skips a blocking field. */
	function validateStep(target: WizardStep): string | null {
		if (target === 1) {
			if (!name.trim()) return t("请填写工程名称");
			if (targets.trim() === "") return t("请至少填写一个目标");
			return null;
		}
		if (target === 2) {
			if (selected.length === 0) return t("请至少选择一个指挥思路");
			return null;
		}
		if (startMode === "scheduled") {
			const parsed = parseScheduleDraft(scheduleDraft);
			return parsed.schedule ? null : (parsed.error ?? t("定时计划无效"));
		}
		return null;
	}

	function goToStep(target: WizardStep): void {
		if (target > step) {
			for (let current = step; current < target; current += 1) {
				const error = validateStep(current as WizardStep);
				if (error) {
					setStep(current as WizardStep);
					setFormError(error);
					return;
				}
			}
		}
		setStep(target);
		setFormError(null);
	}

	function submit(): void {
		for (const current of [1, 2, 3] as const) {
			const error = validateStep(current);
			if (error) {
				setStep(current);
				setFormError(error);
				return;
			}
		}
		const parsed = startMode === "scheduled" ? parseScheduleDraft(scheduleDraft) : {};
		if (startMode === "scheduled" && !parsed.schedule) {
			setFormError(parsed.error ?? t("定时计划无效"));
			return;
		}
		setFormError(null);
		props.onSubmit({
			name: name.trim(),
			targets,
			doctrines: selected,
			presetIds: selectedPresets,
			presetOptional,
			limits: {
				concurrency,
				roundLimit,
				maxRetries,
				tokenLimit: tokenLimit.trim() ? Number.parseInt(tokenLimit, 10) : null,
				timeLimitMin: timeLimitMin.trim() ? Number.parseInt(timeLimitMin, 10) : null,
			},
			gateMode,
			schedule: parsed.schedule,
		});
	}

	function next(): void {
		const error = validateStep(step);
		if (error) {
			setFormError(error);
			return;
		}
		if (step < 3) {
			setStep((step + 1) as WizardStep);
			setFormError(null);
			return;
		}
		submit();
	}

	const nextLabel =
		step === 1
			? t("下一步：指挥设置 →")
			: step === 2
				? t("下一步：执行配置 →")
				: startMode === "scheduled"
					? t("保存计划")
					: t("启动工程 →");

	return (
		<div className="enginewiz">
			<div className="enginewiz-head">
				<div>
					<Title level={4} className="enginewiz-title">
						{t("新建工程")}
					</Title>
					<Text type="secondary">{t("把目标、指挥和执行拆开，完成一步再走一步。")}</Text>
				</div>
				<Button onClick={props.onCancel}>{t("取消")}</Button>
			</div>

			<div className="enginewiz-progress">
				<Steps
					current={step - 1}
					size="small"
					className="enginewiz-steps"
					items={stepMeta.map((item) => ({ title: item.title }))}
				/>
				<Text type="secondary" className="enginewiz-step-hint">
					{t("第 {step} 步 / 共 3 步 · {hint}", { step, hint: stepMeta[step - 1]?.hint ?? "" })}
				</Text>
			</div>

			<Row gutter={[16, 16]}>
				<Col xs={24} lg={16}>
					<Card
						size="small"
						title={
							step === 1
								? t("第 1 步 · 目标")
								: step === 2
									? t("第 2 步 · 指挥")
									: t("第 3 步 · 执行")
						}
					>
						{formError ? <Alert type="error" showIcon className="ui-page__alert" title={formError} /> : null}

						{step === 1 ? (
							<Form layout="vertical" requiredMark={false}>
								<Form.Item label={t("工程名称")} required>
									<Input
										value={name}
										onChange={(event) => {
											setName(event.target.value);
											setFormError(null);
										}}
										placeholder={t("如：内网一批 Web 目标")}
									/>
								</Form.Item>
								<Form.Item
									label={t("目标清单")}
									required
									extra={t("一行一个：目标 + 可选备注 · 支持 IP / 域名 / URL")}
								>
									<Input.TextArea
										value={targets}
										onChange={(event) => {
											setTargets(event.target.value);
											setFormError(null);
										}}
										autoSize={{ minRows: 8, maxRows: 18 }}
										placeholder={t(
											"10.0.0.1 这台是 Web 服务器\n10.0.0.2\nhttp://target.example.com 只测登录功能",
										)}
									/>
								</Form.Item>
								<Text type="secondary">
									{t("目标越具体，指挥官拆出来的任务越稳。备注只给指挥官看，不会被当作命令。")}
								</Text>
							</Form>
						) : null}

						{step === 2 ? (
							<>
								<Text strong className="enginewiz-section">
									{t("指挥思路")}
								</Text>
								{props.doctrines.length === 0 ? (
									<Alert
										type="warning"
										showIcon
										className="ui-page__alert"
										title={t("还没有可用的指挥思路，请先到「指挥思路」页面创建。")}
									/>
								) : (
									<Space orientation="vertical" size={8} className="enginewiz-list">
										{props.doctrines.map((doctrine) => {
											const checked = selected.includes(doctrine.id);
											return (
												<Checkbox
													key={doctrine.id}
													checked={checked}
													className={checked ? "enginewiz-card is-on" : "enginewiz-card"}
													onChange={() => {
														setSelected((prev) =>
															prev.includes(doctrine.id)
																? prev.filter((id) => id !== doctrine.id)
																: [...prev, doctrine.id],
														);
														setFormError(null);
													}}
												>
													<Space size={6} wrap>
														<Text strong>{doctrine.name}</Text>
														{doctrine.builtin ? (
															<Tag variant="filled">{t("内置")}</Tag>
														) : null}
													</Space>
													<Text type="secondary" className="enginewiz-card__text">
														{doctrine.text.split("\n")[0]}
													</Text>
												</Checkbox>
											);
										})}
									</Space>
								)}

								<Text strong className="enginewiz-section">
									{t("Agent 白名单")}
								</Text>
								<Text type="secondary">{t("不勾选 = 不限制，可使用全部已启用预设")}</Text>
								{enabledPresets.length === 0 ? (
									<Alert
										type="info"
										showIcon
										className="ui-page__alert"
										title={t("还没有启用的预设 Agent，可到「设置 → 预设 Agent」创建。")}
									/>
								) : (
									<Space orientation="vertical" size={8} className="enginewiz-list">
										{enabledPresets.map((preset) => {
											const checked = selectedPresets.includes(preset.id);
											return (
												<Checkbox
													key={preset.id}
													checked={checked}
													className={checked ? "enginewiz-card is-on" : "enginewiz-card"}
													title={preset.description || undefined}
													onChange={() =>
														setSelectedPresets((prev) =>
															prev.includes(preset.id)
																? prev.filter((id) => id !== preset.id)
																: [...prev, preset.id],
														)
													}
												>
													<Text strong>{preset.name}</Text>
													<Text type="secondary" className="enginewiz-card__text">
														{preset.description || `${formatUsage(preset.tokens)} tokens`}
													</Text>
												</Checkbox>
											);
										})}
									</Space>
								)}
								<Checkbox
									checked={presetOptional}
									className="enginewiz-optional"
									onChange={(event) => setPresetOptional(event.target.checked)}
								>
									{t("允许任务不指定预设，没有合适预设时退回默认 Agent")}
								</Checkbox>
							</>
						) : null}

						{step === 3 ? (
							<>
								<Space size={8} className="enginewiz-section">
									<Text strong>{t("启动方式")}</Text>
									<Text type="secondary">{t("时区 {timezone}", { timezone: browserTimezone() })}</Text>
								</Space>
								<Segmented
									value={startMode}
									onChange={(value) => {
										setStartMode(value as "now" | "scheduled");
										setFormError(null);
									}}
									options={[
										{ value: "now", label: t("立即启动") },
										{ value: "scheduled", label: t("定时启动") },
									]}
								/>
								{startMode === "scheduled" ? (
									<div className="enginewiz-schedule">
										<ScheduleFields
											draft={scheduleDraft}
											onChange={(nextDraft) => {
												setScheduleDraft(nextDraft);
												setFormError(null);
											}}
											timezone={browserTimezone()}
										/>
									</div>
								) : (
									<Text type="secondary">{t("保存后立即检查 Docker 环境并启动指挥官。")}</Text>
								)}

								<Text strong className="enginewiz-section">
									{t("执行上限")}
								</Text>
								<Row gutter={[12, 12]}>
									<Col xs={12} md={8}>
										<Text type="secondary">{t("最大并发任务")}</Text>
										<InputNumber
											min={1}
											style={{ width: "100%" }}
											value={concurrency}
											onChange={(value) => setConcurrency(value ?? 1)}
										/>
									</Col>
									<Col xs={12} md={8}>
										<Text type="secondary">{t("单任务最大轮数")}</Text>
										<InputNumber
											min={1}
											style={{ width: "100%" }}
											value={roundLimit}
											onChange={(value) => setRoundLimit(value ?? 1)}
										/>
									</Col>
									<Col xs={12} md={8}>
										<Text type="secondary">{t("每目标重试次数")}</Text>
										<InputNumber
											min={0}
											style={{ width: "100%" }}
											value={maxRetries}
											onChange={(value) => setMaxRetries(value ?? 0)}
										/>
									</Col>
									<Col xs={12} md={8}>
										<Text type="secondary">{t("总 token 上限（可选）")}</Text>
										<InputNumber
											min={0}
											style={{ width: "100%" }}
											value={tokenLimit.trim() === "" ? null : Number(tokenLimit)}
											onChange={(value) => setTokenLimit(value === null || value === undefined ? "" : String(value))}
											placeholder={t("不限制")}
										/>
									</Col>
									<Col xs={12} md={8}>
										<Text type="secondary">{t("总时间上限 / 分钟（可选）")}</Text>
										<InputNumber
											min={0}
											style={{ width: "100%" }}
											value={timeLimitMin.trim() === "" ? null : Number(timeLimitMin)}
											onChange={(value) => setTimeLimitMin(value === null || value === undefined ? "" : String(value))}
											placeholder={t("不限制")}
										/>
									</Col>
								</Row>

								<Text strong className="enginewiz-section">
									{t("命令守门")}
								</Text>
								<Radio.Group value={gateMode} onChange={(event) => setGateMode(event.target.value as SentinelEngineGateMode)}>
									<Space orientation="vertical" size={8} className="enginewiz-list">
										<Radio value="auto" className={gateMode === "auto" ? "enginewiz-card is-on" : "enginewiz-card"}>
											<Text strong>{t("自动执行")}</Text>
											<Text type="secondary" className="enginewiz-card__text">
												{t("worker 的命令直接执行，不做拦截（最快）。")}
											</Text>
										</Radio>
										<Radio
											value="ai"
											disabled={!props.judgeAvailable}
											className={gateMode === "ai" ? "enginewiz-card is-on" : "enginewiz-card"}
										>
											<Text strong>{t("AI 裁判")}</Text>
											<Text type="secondary" className="enginewiz-card__text">
												{props.judgeAvailable
													? t("每条命令先由守门模型判定，拦截时把理由回给 worker。")
													: t("未配置守门模型：请先到 设置 → 模型 配置守门模型。")}
											</Text>
										</Radio>
									</Space>
								</Radio.Group>

								<Card size="small" className="enginewiz-review" title={t("确认")}>
									<Space size={24} wrap>
										<Text type="secondary">
											{t("指挥")} <Text strong>{t("{count} 条思路", { count: selected.length })}</Text>
										</Text>
										<Text type="secondary">
											{t("Agent")}{" "}
											<Text strong>
												{selectedPresets.length === 0
													? t("不限制")
													: t("{count} 个预设", { count: selectedPresets.length })}
											</Text>
										</Text>
										<Text type="secondary">
											{t("启动")}{" "}
											<Text strong>
												{startMode === "scheduled"
													? scheduleDraft.startAt
														? scheduleDraft.startAt.replace("T", " ")
														: t("待填写")
													: t("立即")}
											</Text>
										</Text>
									</Space>
								</Card>
								<Text type="secondary">
									{t("启动后指挥官全权调度；人保留暂停、终止、追加目标与 steer。手动暂停、继续或终止会停用后续定时计划。")}
								</Text>
							</>
						) : null}

						<div className="enginewiz-foot">
							<Button disabled={step === 1} onClick={() => goToStep((step - 1) as WizardStep)}>
								{t("上一步")}
							</Button>
							<Button type="primary" onClick={next}>
								{nextLabel}
							</Button>
							<Text type="secondary">{step} / 3</Text>
						</div>
					</Card>
				</Col>
				<Col xs={24} lg={8}>
					<Card size="small" title={t("草稿")} className="enginewiz-draft">
						<Text type="secondary">DRAFT / 0{step}</Text>
						<Text strong>{name.trim() || t("未命名工程")}</Text>
						<Text type="secondary">
							{t("{doctrines} 条思路", { doctrines: selected.length })} · {selectedPresetLabel}
						</Text>
					</Card>
					<Card size="small" title={t("提示")} className="enginewiz-tips">
						<Space orientation="vertical" size={10}>
							<div className="enginewiz-tiprow">
								<Text strong>{t("不会提前启动")}</Text>
								<Text type="secondary" className="enginewiz-tip">
									{t("定时工程只保存计划，到点才检查 Docker 环境。")}
								</Text>
							</div>
							<div className="enginewiz-tiprow">
								<Text strong>{t("失败可以继续")}</Text>
								<Text type="secondary" className="enginewiz-tip">
									{t("环境或指挥官启动失败会停在暂停态，不会丢配置。")}
								</Text>
							</div>
							<div className="enginewiz-tiprow">
								<Text strong>{t("手动优先")}</Text>
								<Text type="secondary" className="enginewiz-tip">
									{t("手动暂停、继续或终止会停用后续计划，避免互相抢状态。")}
								</Text>
							</div>
						</Space>
					</Card>
				</Col>
			</Row>
		</div>
	);
}


function DoctrineManager(props: {
	doctrines: SentinelDoctrineView[];
	onClose(): void;
	onSave(input: { id?: string; name: string; text: string }): void;
	onDelete(id: string): void;
}) {
	const [name, setName] = useState("");
	const [text, setText] = useState("");
	const submit = () => {
		if (!name.trim() || !text.trim()) return;
		props.onSave({ name: name.trim(), text: text.trim() });
		setName("");
		setText("");
	};
	return (
		<div className="doctrinehub">
			<div className="doctrinehub-head">
				<div>
					<Title level={3} className="doctrinehub-title">
						{t("指挥思路")}
					</Title>
					<Text type="secondary">{t("命名的文本模板，创建工程时多选叠加注入指挥官")}</Text>
				</div>
				<Button onClick={props.onClose}>{t("返回")}</Button>
			</div>

			{props.doctrines.length === 0 ? (
				<Alert type="info" showIcon className="ui-page__alert" title={t("还没有指挥思路。在下方新增一条。")} />
			) : (
				<Space orientation="vertical" size={12} className="doctrinehub-list">
					{props.doctrines.map((doctrine) => (
						<Card
							key={doctrine.id}
							size="small"
							title={
								<Space size={8} wrap>
									<Text strong>{doctrine.name}</Text>
									{doctrine.builtin ? <Tag variant="filled">{t("内置")}</Tag> : null}
								</Space>
							}
							extra={
								doctrine.builtin ? null : (
									<Popconfirm
										title={t("删除思路")}
										description={t("删除思路「{name}」？", { name: doctrine.name })}
										okText={t("删除")}
										okButtonProps={{ danger: true }}
										cancelText={t("取消")}
										onConfirm={() => props.onDelete(doctrine.id)}
									>
										<Button size="small" type="link" danger>
											{t("删除")}
										</Button>
									</Popconfirm>
								)
							}
						>
							<pre className="doctrinehub-pre">{doctrine.text}</pre>
						</Card>
					))}
				</Space>
			)}

			<Card size="small" title={t("新增思路")}>
				<Form layout="vertical" requiredMark={false} onFinish={submit}>
					<Form.Item label={t("思路名称")} required>
						<Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("思路名称")} />
					</Form.Item>
					<Form.Item label={t("思路内容（纯文本，注入指挥官系统指令）")} required>
						<Input.TextArea
							rows={6}
							value={text}
							onChange={(event) => setText(event.target.value)}
						/>
					</Form.Item>
					<Button type="primary" htmlType="submit" disabled={!name.trim() || !text.trim()}>
						{t("保存")}
					</Button>
				</Form>
			</Card>
		</div>
	);
}

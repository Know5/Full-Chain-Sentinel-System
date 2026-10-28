import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";
import { Button, Card, Checkbox, Col, Empty, Input, List, Row, Segmented, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { getLanguage, t } from "../i18n.ts";
import {
	buildTurns,
	durationOf,
	formatMs,
	plainText,
	STATUS_LABELS,
	type Step,
	type TextStep,
	type ToolStep,
	toolStatus,
} from "../subagent-process.ts";
import type { SentinelSubagentEvent, SentinelSubagentRun } from "../types.ts";
import { MarkdownText } from "./MessageView.tsx";

const { Text } = Typography;

function formatClock(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString(getLanguage() === "zh" ? "zh-CN" : "en-US", { hour12: false });
}

function scalar(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.join(" ");
	return undefined;
}

const STATUS_COLORS: Record<SentinelSubagentRun["status"], string> = {
	running: "processing",
	done: "green",
	error: "red",
	aborted: "default",
};

/** Structured arguments: the command stands alone, the rest reads as key/value. */
function ToolDetail({
	step,
	onFullscreen,
}: {
	step: ToolStep;
	onFullscreen?: (title: string, output: string) => void;
}) {
	const [copied, setCopied] = useState<"command" | "output" | null>(null);
	const record =
		step.args !== null && typeof step.args === "object" ? (step.args as Record<string, unknown>) : undefined;
	const command = record ? scalar(record.command) : undefined;
	const entries = record ? Object.entries(record).filter(([key]) => key !== "command") : [];

	const copy = async (kind: "command" | "output", text: string): Promise<void> => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(kind);
			window.setTimeout(() => setCopied(null), 1500);
		} catch {
			// Clipboard permission denied; ignore.
		}
	};

	return (
		<div className="sap-detail">
			{command ? <pre className="sap-pre">{command}</pre> : null}
			{entries.length > 0 ? (
				<div className="sap-args">
					{entries.map(([key, value]) => {
						const text = scalar(value);
						return (
							<Space key={key} size={8} align="start" className="sap-arg">
								<Text code>{key}</Text>
								<Text type={text === undefined ? "secondary" : undefined}>
									{text ?? JSON.stringify(value, null, 2)}
								</Text>
							</Space>
						);
					})}
				</div>
			) : null}
			<Space size={8} wrap className="sap-outputhead">
				<Text type="secondary">{t("输出")}</Text>
				{command ? (
					<Button size="small" type="link" onClick={() => void copy("command", command)}>
						{copied === "command" ? t("已复制") : t("复制命令")}
					</Button>
				) : null}
				{step.output ? (
					<Button size="small" type="link" onClick={() => void copy("output", step.output)}>
						{copied === "output" ? t("已复制") : t("复制输出")}
					</Button>
				) : null}
				{step.output && onFullscreen ? (
					<Button size="small" type="link" onClick={() => onFullscreen(step.name, step.output)}>
						{t("全屏")}
					</Button>
				) : null}
			</Space>
			<pre className={step.output ? "sap-pre" : "sap-pre is-empty"}>
				{step.output || (step.running ? t("等待输出…") : t("（无输出）"))}
			</pre>
			{step.truncated ? <Text type="secondary">{t("（输出过长，已截断）")}</Text> : null}
		</div>
	);
}

function ToolRow({
	step,
	expanded,
	onToggle,
	onFullscreen,
}: {
	step: ToolStep;
	expanded: boolean;
	onToggle: () => void;
	onFullscreen?: (title: string, output: string) => void;
}) {
	const status = toolStatus(step);
	const duration = step.durationMs === undefined ? "" : formatMs(step.durationMs);
	return (
		<div
			className={`sap-step sap-tool${status === "error" ? " is-error" : ""}${expanded ? " is-open" : ""}`}
			id={`sa-tool-${step.seq}`}
		>
			<Button type="text" block className="sap-toolrow" onClick={onToggle}>
				{expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
				<Tag variant="filled">{step.name}</Tag>
				{step.summary ? (
					<Text type="secondary" ellipsis className="sap-toolsummary">
						{step.summary}
					</Text>
				) : null}
				<Tag color={status === "running" ? "processing" : status === "error" ? "red" : "green"} variant="filled">
					{status === "running" ? t("运行中") : status === "error" ? t("失败") : t("完成")}
					{duration ? ` ${duration}` : ""}
				</Tag>
			</Button>
			{expanded ? <ToolDetail step={step} onFullscreen={onFullscreen} /> : null}
		</div>
	);
}

function TextRow({ step, expanded, onToggle }: { step: TextStep; expanded: boolean; onToggle: () => void }) {
	return (
		<div className={expanded ? "sap-step sap-text is-open" : "sap-step sap-text is-clamped"}>
			<Button type="text" block className="sap-textbody" onClick={onToggle}>
				{expanded ? (
					<MarkdownText text={step.text} />
				) : (
					<Text type="secondary" ellipsis>
						{plainText(step.text)}
					</Text>
				)}
			</Button>
			{step.truncated ? <Text type="secondary">{t("（内容过长，已截断）")}</Text> : null}
		</div>
	);
}

/** The left column: one row per dispatch, newest first. */
function RunList({
	runs,
	selectedId,
	onSelect,
	page,
	pageCount,
	total,
	onPage,
}: {
	runs: SentinelSubagentRun[];
	selectedId: string | undefined;
	onSelect: (id: string) => void;
	page: number;
	pageCount: number;
	total: number;
	onPage: (page: number) => void;
}) {
	return (
		<Card
			size="small"
			className="sap-list"
			title={t("子代理")}
			extra={
				total > 10 ? (
					<Space size={6}>
						<Button size="small" disabled={page === 0} onClick={() => onPage(page - 1)}>
							{t("上一页")}
						</Button>
						<Text type="secondary">
							{page + 1} / {pageCount}
						</Text>
						<Button size="small" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>
							{t("下一页")}
						</Button>
						<Text type="secondary">{t("共 {total}", { total })}</Text>
					</Space>
				) : null
			}
		>
			{runs.length === 0 ? (
				<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("加载中…")} />
			) : (
				<List
					size="small"
					dataSource={runs}
					renderItem={(run) => {
						const duration = durationOf(run);
						return (
							<List.Item
								className={run.id === selectedId ? "sap-run is-selected" : "sap-run"}
								onClick={() => onSelect(run.id)}
							>
								<div className="sap-run__text">
									<Space size={6} wrap>
										<Tag color={STATUS_COLORS[run.status]} variant="filled">
											{STATUS_LABELS[run.status]}
										</Tag>
										<Text type="secondary">{formatClock(run.startedAt)}</Text>
									</Space>
									<Text ellipsis title={run.task}>
										{run.task}
									</Text>
									<Text type="secondary">
										{t("{turns} 轮", { turns: run.turns })}
										{duration ? ` · ${duration}` : ""}
									</Text>
								</div>
							</List.Item>
						);
					}}
				/>
			)}
		</Card>
	);
}

/** The right column: the selected run's process, result and controls. */
function RunDetail({
	run,
	events,
	onAbort,
	onSteer,
	onFullscreen,
}: {
	run: SentinelSubagentRun;
	events: SentinelSubagentEvent[];
	onAbort: (id: string) => void;
	onSteer: (id: string, text: string) => void;
	onFullscreen?: (title: string, output: string) => void;
}) {
	const turns = useMemo(() => buildTurns(events), [events]);
	const steps = useMemo(() => turns.flatMap((turn) => turn.steps), [turns]);
	const [tab, setTab] = useState<"process" | "result">(run.status === "running" ? "process" : "result");
	const [query, setQuery] = useState("");
	const [failuresOnly, setFailuresOnly] = useState(false);
	const [steerText, setSteerText] = useState("");
	// Only the operator's explicit choices are stored; a running call defaults to
	// expanded so the step being executed is visible, a finished one to collapsed.
	const [overrides, setOverrides] = useState<Map<number, boolean>>(() => new Map());
	const [expandedText, setExpandedText] = useState<Set<number>>(() => {
		const last = [...steps].reverse().find((step) => step.kind === "text");
		return new Set(last ? [last.seq] : []);
	});
	const [follow, setFollow] = useState(true);
	const bodyRef = useRef<HTMLDivElement | null>(null);

	const needle = query.trim().toLowerCase();
	const filtering = needle !== "" || failuresOnly;

	// Follow the newest step while the run is live, until the operator scrolls up.
	useEffect(() => {
		if (!follow || tab !== "process") return;
		const body = bodyRef.current;
		if (!body) return;
		body.scrollTop = body.scrollHeight;
	}, [follow, tab, events.length]);

	const visible = (step: Step): boolean => {
		if (step.kind === "tool") {
			if (failuresOnly && !step.isError) return false;
			if (needle === "") return true;
			return `${step.name} ${step.summary} ${step.output}`.toLowerCase().includes(needle);
		}
		if (failuresOnly) return false;
		if (needle === "") return true;
		if (step.kind === "text" || step.kind === "thinking") return step.text.toLowerCase().includes(needle);
		return step.note.toLowerCase().includes(needle);
	};

	const shownTurns = filtering
		? turns.map((turn) => ({ ...turn, steps: turn.steps.filter(visible) })).filter((turn) => turn.steps.length > 0)
		: turns;
	const toolCount = turns.reduce((sum, turn) => sum + turn.tools, 0);
	const failureCount = turns.reduce((sum, turn) => sum + turn.failures, 0);
	const firstFailure = steps.find((step): step is ToolStep => step.kind === "tool" && step.isError);
	const isExpanded = (step: ToolStep): boolean => overrides.get(step.seq) ?? step.running;
	const toggleTool = (step: ToolStep): void => {
		setOverrides((prev) => new Map(prev).set(step.seq, !(prev.get(step.seq) ?? step.running)));
	};

	const duration = durationOf(run);

	return (
		<Card
			size="small"
			className="sap-detail"
			title={
				<div className="sap-title">
					<Text strong ellipsis title={run.task}>
						{run.task}
					</Text>
					<Space size={6} wrap>
						<Tag color={STATUS_COLORS[run.status]} variant="filled">
							{STATUS_LABELS[run.status]}
						</Tag>
						<Text type="secondary">
							{t("{turns} 轮", { turns: run.turns })}
							{duration ? ` · ${duration}` : ""} · {formatClock(run.startedAt)}
						</Text>
					</Space>
				</div>
			}
		>
			<div className="sap-toolbar">
				<Segmented
					size="small"
					value={tab}
					onChange={(value) => setTab(value as "process" | "result")}
					options={[
						{
							value: "process",
							label: (
								<Space size={4}>
									{t("过程")}
									<Tag variant="filled">{toolCount}</Tag>
									{failureCount > 0 ? (
										<Tag color="red" variant="filled">
											{t("{count} 个失败", { count: failureCount })}
										</Tag>
									) : null}
								</Space>
							),
						},
						{ value: "result", label: t("结果") },
					]}
				/>
				{tab === "process" ? (
					<Space size={6} wrap>
						<Input
							size="small"
							allowClear
							style={{ width: 180 }}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("搜索命令、输出…")}
							spellCheck={false}
						/>
						<Checkbox checked={failuresOnly} onChange={(event) => setFailuresOnly(event.target.checked)}>
							{t("只看失败")}
						</Checkbox>
						{firstFailure ? (
							<Button
								size="small"
								onClick={() => {
									// A filter could be hiding the row, so clear it first and
									// scroll after the list has been re-rendered.
									setQuery("");
									setFailuresOnly(false);
									window.requestAnimationFrame(() =>
										document
											.getElementById(`sa-tool-${firstFailure.seq}`)
											?.scrollIntoView({ block: "center" }),
									);
								}}
							>
								{t("跳到第一个失败")}
							</Button>
						) : null}
						<Button
							size="small"
							type={follow ? "primary" : "default"}
							title={t("跟随最新步骤")}
							onClick={() => setFollow((prev) => !prev)}
						>
							{t("跟随")}
						</Button>
					</Space>
				) : null}
			</div>

			<div
				className="sap-body"
				ref={bodyRef}
				onScroll={(event) => {
					const body = event.currentTarget;
					setFollow(body.scrollHeight - body.scrollTop - body.clientHeight < 24);
				}}
			>
				{tab === "result" ? (
					<div className="sap-result">
						{run.error ? (
							<Text type="danger" className="sap-error">
								{run.error}
							</Text>
						) : null}
						{run.result ? (
							<MarkdownText text={run.result} />
						) : (
							<Empty
								image={Empty.PRESENTED_IMAGE_SIMPLE}
								description={run.status === "running" ? t("运行中，还没有产出结果") : t("（没有结果）")}
							/>
						)}
					</div>
				) : events.length === 0 ? (
					<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无过程记录")} />
				) : shownTurns.length === 0 ? (
					<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有匹配的步骤")} />
				) : (
					<div className="sap-process">
						{shownTurns.map((turn) => (
							<div key={turn.index} className="sap-turn">
								<Space size={8} wrap className="sap-turnhead">
									<Text strong>{t("第 {round} 轮", { round: turn.index })}</Text>
									<Text type="secondary">
										{t("{count} 个工具", { count: turn.tools })}
										{turn.durationMs > 0 ? ` · ${formatMs(turn.durationMs)}` : ""}
									</Text>
									{turn.failures > 0 ? (
										<Tag color="red" variant="filled">
											{t("{count} 个失败", { count: turn.failures })}
										</Tag>
									) : null}
								</Space>
								{turn.steps.map((step) => {
									if (step.kind === "tool") {
										return (
											<ToolRow
												key={step.seq}
												step={step}
												expanded={isExpanded(step)}
												onToggle={() => toggleTool(step)}
												onFullscreen={onFullscreen}
											/>
										);
									}
									if (step.kind === "text") {
										return (
											<TextRow
												key={step.seq}
												step={step}
												expanded={expandedText.has(step.seq)}
												onToggle={() =>
													setExpandedText((prev) => {
														const next = new Set(prev);
														if (next.has(step.seq)) next.delete(step.seq);
														else next.add(step.seq);
														return next;
													})
												}
											/>
										);
									}
									if (step.kind === "thinking") {
										return (
											<details key={step.seq} className="sap-thinking">
												<summary>
													<Text type="secondary">
														{t("思考 · {count} 字", { count: step.text.length })}
													</Text>
												</summary>
												<pre className="sap-pre">{step.text}</pre>
											</details>
										);
									}
									return (
										<Text key={step.seq} type="secondary" className="sap-status">
											{step.note}
										</Text>
									);
								})}
							</div>
						))}
					</div>
				)}
			</div>

			{run.status === "running" ? (
				<Space size={8} wrap className="sap-controls">
					<Button danger onClick={() => onAbort(run.id)}>
						{t("中止该子代理")}
					</Button>
					<Input
						style={{ flex: 1, minWidth: 220 }}
						value={steerText}
						placeholder={t("给该子代理追加指令…")}
						onChange={(event) => setSteerText(event.target.value)}
						onPressEnter={() => {
							if (steerText.trim()) {
								onSteer(run.id, steerText.trim());
								setSteerText("");
							}
						}}
					/>
					<Button
						type="primary"
						disabled={!steerText.trim()}
						onClick={() => {
							onSteer(run.id, steerText.trim());
							setSteerText("");
						}}
					>
						{t("追加")}
					</Button>
				</Space>
			) : null}
		</Card>
	);
}

const SUBAGENT_PAGE_SIZE = 8;

export function SubagentPanel({
	runs,
	total,
	pageRuns,
	pageOffset,
	onLoadPage,
	transcripts,
	onLoad,
	onAbort,
	onSteer,
	onFullscreen,
}: {
	/** Newest page from the snapshot (first 100 runs). */
	runs: SentinelSubagentRun[];
	/** All runs of the session, for the page count. */
	total: number;
	/** An older page fetched on demand; null until requested. */
	pageRuns: SentinelSubagentRun[] | null;
	pageOffset: number;
	onLoadPage: (offset: number, limit: number) => void;
	/** Process steps by run id; a run absent here has not been loaded yet. */
	transcripts: Record<string, SentinelSubagentEvent[]>;
	onLoad: (id: string) => void;
	onAbort: (id: string) => void;
	onSteer: (id: string, text: string) => void;
	onFullscreen?: (title: string, output: string) => void;
}) {
	const [page, setPage] = useState(0);
	const [pickedId, setPickedId] = useState<string | undefined>(undefined);
	const effectiveTotal = Math.max(total, runs.length);
	const pageCount = Math.max(1, Math.ceil(effectiveTotal / SUBAGENT_PAGE_SIZE));
	const start = page * SUBAGENT_PAGE_SIZE;
	const expected = Math.min(SUBAGENT_PAGE_SIZE, Math.max(0, effectiveTotal - start));

	// The snapshot only carries the newest 100 runs; older pages are requested on
	// demand. The callback is recreated by the parent on every render, so it is
	// kept in a ref and excluded from the effect dependencies.
	const loadRef = useRef(onLoadPage);
	loadRef.current = onLoadPage;
	const requested = useRef(new Set<number>());
	useEffect(() => {
		if (page >= pageCount) {
			setPage(pageCount - 1);
			return;
		}
		if (start + expected <= runs.length) return;
		const covered =
			pageRuns !== null && pageOffset <= start && start + expected <= pageOffset + pageRuns.length;
		if (covered || requested.current.has(start)) return;
		requested.current.add(start);
		loadRef.current(start, SUBAGENT_PAGE_SIZE);
	}, [page, pageCount, start, expected, runs.length, pageRuns, pageOffset]);

	const visible =
		start + expected <= runs.length
			? runs.slice(start, start + expected)
			: pageRuns && pageOffset <= start && start + expected <= pageOffset + pageRuns.length
				? pageRuns.slice(start - pageOffset, start - pageOffset + expected)
				: [];

	// Nothing picked yet: the newest live run is what the operator wants to watch.
	const selected =
		visible.find((run) => run.id === pickedId) ??
		visible.find((run) => run.status === "running") ??
		visible[0];
	const selectedId = selected?.id;
	const loaded = selectedId !== undefined && transcripts[selectedId] !== undefined;

	// Load the process once, the first time a run is shown. Keyed on the selection
	// rather than on `transcripts`/`onLoad`, which are rebuilt on every snapshot.
	useEffect(() => {
		if (selectedId !== undefined && !loaded) onLoad(selectedId);
	}, [selectedId, loaded, onLoad]);

	if (runs.length === 0 && total === 0) {
		return (
			<Empty
				image={Empty.PRESENTED_IMAGE_SIMPLE}
				description={t("当前会话还没有子代理。让主代理用 spawn_agent 派发独立任务后，这里会显示它的实时过程。")}
			/>
		);
	}

	return (
		<Row gutter={[12, 12]} className="sap">
			<Col xs={24} lg={8}>
				<RunList
					runs={visible}
					selectedId={selectedId}
					onSelect={setPickedId}
					page={page}
					pageCount={pageCount}
					total={total}
					onPage={setPage}
				/>
			</Col>
			<Col xs={24} lg={16}>
				{selected ? (
					<RunDetail
						key={selected.id}
						run={selected}
						events={transcripts[selected.id] ?? []}
						onAbort={onAbort}
						onSteer={onSteer}
						onFullscreen={onFullscreen}
					/>
				) : (
					<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无子代理")} />
				)}
			</Col>
		</Row>
	);
}

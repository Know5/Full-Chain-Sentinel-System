/**
 * The persistent goal bar of the chat page.
 *
 * A goal runs unattended for hours, so the default state is a single strip that
 * answers four questions at a glance: is it running, how much of the round
 * budget is left, what has it cost, and what did the last round report. Everything
 * long (criteria, the round-by-round audit trail, the completion evidence or the
 * blocker that stopped it) lives in a right-hand drawer with its own scroll:
 * an unbounded inline block used to squeeze the transcript to nothing and clip
 * its own tail, which no amount of scrolling could reach.
 */

import { Alert, Button, Card, Descriptions, Drawer, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { t } from "../i18n.ts";
import { formatTokens } from "../transcript.ts";
import type { SentinelGoalRound, SentinelGoalView } from "../types.ts";

const { Text } = Typography;

/** Status chip text. Mirrors the server's labels, including the pause reason. */
function statusLabel(goal: SentinelGoalView): string {
	if (goal.status === "active") return goal.running ? t("运行中") : t("进行中");
	if (goal.status === "completed") return t("已完成");
	if (goal.status === "blocked") return t("已阻塞");
	switch (goal.pauseReason) {
		case "limit":
			return t("已暂停 · 轮数上限");
		case "no-progress":
			return t("已暂停 · 空转熔断");
		case "interrupted":
			return t("已暂停 · 会话重建");
		case "loop-guard":
			return t("已暂停 · 输出重复");
		default:
			return t("已暂停");
	}
}

const STATUS_COLORS: Record<SentinelGoalView["status"], string> = {
	active: "processing",
	completed: "success",
	blocked: "error",
	paused: "warning",
};

/** Elapsed time in the console's short form: seconds, then minutes, then hours. */
function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

function roundLabel(round: SentinelGoalRound): string {
	const kind = round.kind === "initial" ? t("初始运行") : t("自动续跑");
	const outcome =
		round.outcome === "completed"
			? t(" · 已完成")
			: round.outcome === "blocked"
				? t(" · 已阻塞")
				: round.outcome === "aborted"
					? t(" · 被中止")
					: round.outcome === "error"
						? t(" · 失败")
						: round.outcome === "paused"
							? t(" · 已暂停")
							: "";
	return t("第 {index} 轮 · {kind}{outcome}", { index: round.index, kind, outcome });
}

function RoundEntry({ round }: { round: SentinelGoalRound }) {
	const duration =
		typeof round.endedAt === "number" && round.endedAt > round.startedAt
			? formatElapsed(round.endedAt - round.startedAt)
			: t("进行中");
	const tokens = round.usage && round.usage.total > 0 ? ` · ${formatTokens(round.usage.total)} tokens` : "";
	return (
		<Card size="small" className="goalhub-round">
			<Text strong>{roundLabel(round)}</Text>
			<Text type="secondary" className="goalhub-round__meta">
				{new Date(round.startedAt).toLocaleTimeString("zh-CN", { hour12: false })} · {duration} ·{" "}
				{t("{count} 次工具调用", { count: round.toolCalls })}
				{tokens}
			</Text>
			{round.summary ? <pre className="goalhub-pre">{round.summary}</pre> : null}
			{round.blockerReason ? (
				<Alert
					type="error"
					showIcon
					title={t("报告阻塞：{reason}", { reason: round.blockerReason })}
					className="goalhub-alert"
				/>
			) : null}
		</Card>
	);
}

/** One labelled list in the drawer (progress sections and criteria share it). */
function GoalList({ label, items }: { label: string; items: string[] }) {
	if (items.length === 0) return null;
	return (
		<div className="goalhub-group">
			<Text strong className="goalhub-group__label">
				{label}
			</Text>
			<ul className="goalhub-list">
				{items.map((item, index) => (
					<li key={`${label}-${index}`}>{item}</li>
				))}
			</ul>
		</div>
	);
}

/**
 * The drawer: full metrics, criteria, progress, the round audit trail and the
 * outcome. It scrolls on its own, so length can never push the chat out of view.
 */
function GoalDetail({
	goal,
	elapsed,
	active,
	onPause,
	onResume,
	onClear,
	onClose,
}: {
	goal: SentinelGoalView;
	elapsed: number;
	active: boolean;
	onPause: () => void;
	onResume: () => void;
	onClear: () => void;
	onClose: () => void;
}) {
	const progress = goal.progress;
	return (
		<Drawer
			open
			width={560}
			onClose={onClose}
			destroyOnHidden
			title={t("目标详情")}
			className="goalhub-drawer"
			extra={
				<Tag color={STATUS_COLORS[goal.status]} variant="filled">
					{statusLabel(goal)}
				</Tag>
			}
			footer={
				<Space size={8} className="goalhub-foot">
					{active ? (
						<Button onClick={onPause} title={t("停止当前运行并暂停目标")}>
							{t("暂停")}
						</Button>
					) : goal.status === "completed" ? null : (
						<Button type="primary" onClick={onResume} title={t("再给 3 轮自动续跑并立即开始")}>
							{t("继续 +3 轮")}
						</Button>
					)}
					<Button danger onClick={onClear} title={t("清除目标（正在运行时会先中止）")}>
						{t("清除")}
					</Button>
				</Space>
			}
		>
			<Text className="goalhub-objective">{goal.objective}</Text>

			<Descriptions
				size="small"
				column={2}
				bordered
				className="goalhub-desc"
				items={[
					{
						key: "rounds",
						label: t("轮次"),
						children: `${goal.roundsUsed}/${goal.roundLimit} ${t("（初始运行不计入）")}`,
					},
					{ key: "elapsed", label: t("耗时"), children: formatElapsed(elapsed) },
					{ key: "tokens", label: "Token", children: formatTokens(goal.usage.total) },
					{
						key: "subagent",
						label: t("子代理"),
						children: t("{runs} 次 · {turns} 轮", { runs: goal.subagent.runs, turns: goal.subagent.turns }),
					},
					{ key: "submitted", label: t("中枢"), children: t("{count} 条", { count: goal.submitted }) },
					{ key: "mode", label: t("模式"), children: t("自动模式 · 全放行") },
					{ key: "id", label: t("目标 ID"), children: <Text code>{goal.id}</Text> },
				]}
			/>

			{goal.status === "paused" && goal.pauseNote ? (
				<Alert
					type="warning"
					showIcon
					className="goalhub-alert"
					title={t("暂停说明：{note}", { note: goal.pauseNote })}
				/>
			) : null}
			{goal.blocked ? (
				<Alert
					type="error"
					showIcon
					className="goalhub-alert"
					title={t("阻塞原因：{reason}（同一阻塞连续 {count} 轮）", {
						reason: goal.blocked.reason,
						count: goal.blocked.streak,
					})}
				/>
			) : null}

			{goal.criteria.length > 0 ? (
				<GoalList label={t("验收标准")} items={goal.criteria.map((item, index) => `${index + 1}. ${item}`)} />
			) : null}

			<div className="goalhub-group">
				<Text strong className="goalhub-group__label">
					{t("进度")}
				</Text>
				{progress.done.length === 0 && progress.todo.length === 0 && progress.blockers.length === 0 ? (
					<Text type="secondary">{t("还没有进度记录。")}</Text>
				) : null}
				<GoalList label={t("已完成")} items={progress.done} />
				<GoalList label={t("待办")} items={progress.todo} />
				<GoalList label={t("阻塞")} items={progress.blockers} />
			</div>

			<Text strong className="goalhub-group__label">
				{t("执行记录 · {count} 轮", { count: goal.rounds.length })}
			</Text>
			{goal.rounds.length === 0 ? (
				<Text type="secondary">{t("还没有轮次记录。")}</Text>
			) : (
				<div className="goalhub-rounds">
					{goal.rounds.map((round) => (
						<RoundEntry key={round.index} round={round} />
					))}
				</div>
			)}

			{goal.completion ? (
				<Card size="small" title={t("完成结论")} className="goalhub-completion">
					<pre className="goalhub-pre">{goal.completion.summary}</pre>
					{goal.completion.criteria.length > 0 ? (
						<GoalList
							label={t("逐条判定")}
							items={goal.completion.criteria.map((item) =>
								t("{state}：{criterion} —— {evidence}", {
									state: item.met ? t("满足") : t("未满足"),
									criterion: item.criterion,
									evidence: item.evidence,
								}),
							)}
						/>
					) : null}
					{goal.completion.evidence.length > 0 ? (
						<GoalList label={t("证据")} items={goal.completion.evidence} />
					) : null}
					<Text type="secondary">
						{t("中枢记录 {count} 条", { count: goal.completion.submitted })}
						{goal.completion.findingsNote ? ` · ${goal.completion.findingsNote}` : ""}
					</Text>
				</Card>
			) : null}
		</Drawer>
	);
}

export function GoalBar({
	goal,
	streaming,
	onPause,
	onResume,
	onClear,
}: {
	goal: SentinelGoalView;
	streaming: boolean;
	onPause: () => void;
	onResume: () => void;
	onClear: () => void;
}) {
	const [now, setNow] = useState(() => Date.now());
	const [detailOpen, setDetailOpen] = useState(false);

	// Only a goal that is still moving needs a clock; a finished one shows its
	// final duration and stops re-rendering.
	useEffect(() => {
		if (goal.status !== "active") return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [goal.status]);

	const elapsed = (goal.endedAt ?? now) - goal.startedAt;
	const active = goal.status === "active";
	const lastRound = goal.rounds[goal.rounds.length - 1];

	return (
		<>
			<div className={`goalhub-strip is-${goal.status}`}>
				<Tag color={STATUS_COLORS[goal.status]} variant="filled">
					{statusLabel(goal)}
				</Tag>
				<Text className="goalhub-strip__objective" ellipsis title={goal.objective}>
					{goal.objective}
				</Text>
				<Space size={14} wrap className="goalhub-strip__stats">
					<Text type="secondary" title={t("自动续跑已用轮数 / 上限；初始运行不计入")}>
						{t("轮次")}{" "}
						<Text strong>
							{goal.roundsUsed}/{goal.roundLimit}
						</Text>
					</Text>
					<Text type="secondary">
						{t("耗时")} <Text strong>{formatElapsed(elapsed)}</Text>
					</Text>
					<Text type="secondary" title={t("本目标开始以来的主代理用量")}>
						Token <Text strong>{formatTokens(goal.usage.total)}</Text>
					</Text>
					<Text type="secondary" title={t("本目标期间提交到漏洞中枢的记录数")}>
						{t("中枢")} <Text strong>{goal.submitted}</Text> {t("条")}
					</Text>
					{goal.subagent.runs > 0 ? (
						<Text type="secondary" title={t("子代理用量只作展示，不消耗续跑轮数")}>
							{t("子代理")} <Text strong>{goal.subagent.runs}</Text> {t("次")}
						</Text>
					) : null}
					{streaming && !active ? (
						<Tag color="orange" variant="filled">
							{t("后台仍在运行")}
						</Tag>
					) : null}
				</Space>
				<Space size={6} className="goalhub-strip__ops">
					<Button
						size="small"
						type="link"
						onClick={() => setDetailOpen(true)}
						title={
							lastRound?.summary
								? t("详情：验收标准、进度与执行记录；最近一轮：{summary}", {
										summary: lastRound.summary.split("\n")[0],
									})
								: t("详情：验收标准、进度与执行记录")
						}
					>
						{t("详情")}
					</Button>
					{active ? (
						<Button size="small" onClick={onPause} title={t("停止当前运行并暂停目标")}>
							{t("暂停")}
						</Button>
					) : goal.status === "completed" ? null : (
						<Button size="small" onClick={onResume} title={t("再给 3 轮自动续跑并立即开始")}>
							{t("继续 +3 轮")}
						</Button>
					)}
					<Button size="small" danger onClick={onClear} title={t("清除目标（正在运行时会先中止）")}>
						{t("清除")}
					</Button>
				</Space>
			</div>
			{detailOpen ? (
				<GoalDetail
					goal={goal}
					elapsed={elapsed}
					active={active}
					onPause={onPause}
					onResume={onResume}
					onClear={onClear}
					onClose={() => setDetailOpen(false)}
				/>
			) : null}
		</>
	);
}

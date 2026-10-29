import {
	ArrowRightOutlined,
	AuditOutlined,
	BugOutlined,
	MessageOutlined,
	ThunderboltOutlined,
} from "@ant-design/icons";
import { Badge, Button, Card, Empty, Skeleton, Tag, Typography } from "antd";
import { t, getLanguage } from "../i18n.ts";
import type {
	SentinelEngine,
	SentinelPageId,
	SentinelProjectInfo,
	SentinelVulnStats,
	SessionInfoView,
} from "../types.ts";
import { SENTINEL_VULN_SEVERITIES, SENTINEL_VULN_SEVERITY_LABELS } from "../types.ts";
import "./dashboard.css";

const { Text } = Typography;

export interface DashboardPageProps {
	project: SentinelProjectInfo | null;
	sessions: SessionInfoView[];
	runningSessions: string[];
	engines: SentinelEngine[];
	pendingApprovals: number;
	vulnStats: SentinelVulnStats;
	loading: boolean;
	onNavigate: (page: SentinelPageId) => void;
	onOpenSession: (path: string) => void;
}

export function DashboardPage({
	project,
	sessions,
	runningSessions,
	engines,
	pendingApprovals,
	vulnStats,
	loading,
	onNavigate,
	onOpenSession,
}: DashboardPageProps) {
	const projectEngines = engines.filter((engine) => engine.projectId === project?.id);
	const runningTasks = projectEngines.flatMap((engine) => engine.tasks.filter((task) => task.status === "running"));
	const projectSessionIds = new Set(sessions.map((session) => session.id));
	const runningIds = new Set([
		...runningSessions.filter((id) => projectSessionIds.has(id)),
		...runningTasks.flatMap((task) => (task.sessionId ? [task.sessionId] : [])),
	]);
	const runningCount = runningIds.size + runningTasks.filter((task) => !task.sessionId).length;
	const recent = [...sessions].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)).slice(0, 6);
	const active = sessions.filter((session) => runningIds.has(session.id));
	const projectRunning = project?.state === "running";
	const metrics = [
		{
			label: t("运行中任务"),
			value: runningCount,
			icon: <ThunderboltOutlined />,
			hint: t("对话与工程任务"),
			page: runningTasks.length > 0 ? ("engine" as const) : ("chat" as const),
		},
		{
			label: t("待审批"),
			value: pendingApprovals,
			icon: <AuditOutlined />,
			hint: t("全部项目待处理命令"),
			page: "chat" as const,
		},
		{
			label: t("漏洞"),
			value: vulnStats.total,
			icon: <BugOutlined />,
			hint: t("待确认 {count}", { count: vulnStats.byStatus.pending }),
			page: "vulns" as const,
		},
		{
			label: t("会话"),
			value: sessions.length,
			icon: <MessageOutlined />,
			hint: t("当前项目"),
			page: "chat" as const,
		},
	];

	return (
		<div className="ui-page dashboard">
			<div className="dashboard__metrics">
				{metrics.map((metric) => (
					<button
						key={metric.label}
						type="button"
						className="dashboard__metric"
						disabled={loading}
						onClick={() => onNavigate(metric.page)}
					>
						<span className="dashboard__metric-label">
							{metric.icon}
							{metric.label}
							<ArrowRightOutlined />
						</span>
						<strong>{loading ? "—" : metric.value}</strong>
						<Text type="secondary">{metric.hint}</Text>
					</button>
				))}
			</div>

			<div className="dashboard__columns">
				<Card
					size="small"
					title={t("最近会话")}
					extra={
						<Button type="link" size="small" onClick={() => onNavigate("chat")}>
							{t("查看全部")}
							<ArrowRightOutlined />
						</Button>
					}
				>
					{loading ? (
						<Skeleton active paragraph={{ rows: 4 }} />
					) : recent.length === 0 ? (
						<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无会话")} />
					) : (
						<div className="dashboard__sessions">
							{recent.map((session) => {
								const modified = new Date(session.modified);
								return (
									<button
										key={session.path}
										type="button"
										className="dashboard__session"
										onClick={() => onOpenSession(session.path)}
									>
										<Badge status={runningIds.has(session.id) ? "processing" : "default"} />
										<span className="dashboard__session-copy">
											<span>{session.name || session.firstMessage.slice(0, 60) || t("未命名会话")}</span>
											<Text type="secondary">
												{session.engine?.engineName ?? t("对话")} ·{" "}
												{t("{count} 条消息", { count: session.messageCount })}
											</Text>
										</span>
										<time
											className="dashboard__session-time"
											dateTime={Number.isNaN(modified.getTime()) ? undefined : modified.toISOString()}
										>
											{Number.isNaN(modified.getTime())
												? "—"
												: modified.toLocaleDateString(getLanguage() === "en" ? "en-US" : "zh-CN", {
														month: "short",
														day: "numeric",
													})}
										</time>
										<ArrowRightOutlined />
									</button>
								);
							})}
						</div>
					)}
				</Card>

				<div className="dashboard__secondary">
					<Card
						size="small"
						title={t("运行状态")}
						extra={
							<Tag color={projectRunning ? "green" : "default"}>
								{projectRunning ? t("容器运行中") : t("容器未运行")}
							</Tag>
						}
					>
						{loading ? (
							<Skeleton active paragraph={{ rows: 2 }} />
						) : active.length > 0 ? (
							<div className="dashboard__active">
								{active.slice(0, 3).map((session) => (
									<Button key={session.path} type="text" block onClick={() => onOpenSession(session.path)}>
										<Badge status="processing" />
										<span>{session.name || session.firstMessage.slice(0, 60) || t("未命名会话")}</span>
										<ArrowRightOutlined />
									</Button>
								))}
							</div>
						) : (
							<Text type="secondary">
								{runningCount > 0 ? t("工程任务正在运行，可前往工程查看详情。") : t("当前没有运行中的任务。")}
							</Text>
						)}
						<div className="dashboard__status-footer">
							<Text type="secondary">
								{t("工程")} {projectEngines.length}
							</Text>
							<Button size="small" type="link" onClick={() => onNavigate("engine")}>
								{t("查看工程")}
								<ArrowRightOutlined />
							</Button>
						</div>
					</Card>
					<Card
						size="small"
						title={t("漏洞分布")}
						extra={
							<Button size="small" type="link" onClick={() => onNavigate("vulns")}>
								{t("查看漏洞")}
								<ArrowRightOutlined />
							</Button>
						}
					>
						<div className="dashboard__severity">
							{SENTINEL_VULN_SEVERITIES.map((severity) => (
								<div key={severity} className={`dashboard__severity-row is-${severity}`}>
									<span>{SENTINEL_VULN_SEVERITY_LABELS[severity]}</span>
									<span className="dashboard__severity-track">
										<span
											style={{
												width: `${vulnStats.total ? (vulnStats.bySeverity[severity] / vulnStats.total) * 100 : 0}%`,
											}}
										/>
									</span>
									<strong>{loading ? "—" : vulnStats.bySeverity[severity]}</strong>
								</div>
							))}
						</div>
					</Card>
				</div>
			</div>
		</div>
	);
}

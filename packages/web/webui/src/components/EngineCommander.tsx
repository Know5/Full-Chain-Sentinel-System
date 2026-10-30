import { Badge, Button, Empty, Input, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { commanderEntries } from "../commander-process.ts";
import { t } from "../i18n.ts";
import { formatMs, toolSummary } from "../subagent-process.ts";
import type { SentinelEngine, SentinelSubagentEvent } from "../types.ts";

const { Text } = Typography;

const STATUS_LABELS: Record<SentinelEngine["status"], string> = {
	running: t("执行中"),
	completed: t("已完成"),
	paused: t("已暂停"),
	scheduled: t("等待开始"),
	stopped: t("已终止"),
};

function clock(at: number): string {
	return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
}

export function CommanderFeed({
	engineId,
	status,
	events,
	onSend,
}: {
	engineId: string;
	status: SentinelEngine["status"];
	events: SentinelSubagentEvent[];
	onSend: (message: unknown) => void;
}) {
	const canChat = status === "running" || status === "completed";
	const [draft, setDraft] = useState("");
	const feed = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const entries = useMemo(() => commanderEntries(events), [events]);
	useEffect(() => {
		if (feed.current && follow.current) feed.current.scrollTop = feed.current.scrollHeight;
	}, [entries]);
	const sendDraft = (): void => {
		const text = draft.trim();
		if (!text || !canChat) return;
		onSend({ type: "engine_steer_commander", id: engineId, text });
		setDraft("");
		follow.current = true;
	};
	return (
		<section className="engine-commander" aria-label={t("指挥官")}>
			<div className="engine-workspace__panel-head">
				<Text strong>{t("指挥官")}</Text>
				<Badge
					status={status === "running" ? "processing" : status === "completed" ? "success" : "default"}
					text={STATUS_LABELS[status]}
				/>
			</div>
			<div
				ref={feed}
				className="engine-commander__stream"
				aria-live="polite"
				onScroll={() => {
					const element = feed.current;
					if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
				}}
			>
				{entries.length === 0 ? (
					<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("指挥官还没有动作。")} />
				) : null}
				{entries.map((entry) => {
					if (entry.kind === "tool") {
						const { start, end } = entry;
						const name = start.toolName ?? end?.toolName ?? t("工具调用");
						const pending = !end;
						const duration = end ? (end.durationMs ?? (start === end ? undefined : end.at - start.at)) : undefined;
						const summary = toolSummary(
							name,
							start.args,
							end?.output ?? "",
							pending ? "running" : end.isError ? "error" : "done",
						);
						return (
							<details key={start.seq} className="engine-commander__process">
								<summary>
									<time className="engine-commander__time">{clock(start.at)}</time>
									<span className="engine-commander__tool" title={name}>
										{name}
									</span>
									<span className="engine-commander__preview" title={summary}>
										{summary || "—"}
									</span>
									<span className={end?.isError ? "engine-commander__result is-error" : "engine-commander__result"}>
										{pending ? (status === "running" ? t("执行中") : t("未完成")) : end.isError ? t("失败") : t("成功")}
									</span>
									{duration !== undefined ? (
										<span className="engine-commander__duration">{formatMs(duration)}</span>
									) : null}
								</summary>
								<div className="engine-commander__details">
									{start.args !== undefined ? (
										<div>
											<Text type="secondary">{t("参数")}</Text>
											<pre>{typeof start.args === "string" ? start.args : JSON.stringify(start.args, null, 2)}</pre>
										</div>
									) : null}
									{end ? (
										<div>
											<Text type="secondary">{t("结果")}</Text>
											<pre>{end.output || t("（无输出）")}</pre>
											{end.truncated ? <Text type="secondary">{t("输出已截断")}</Text> : null}
										</div>
									) : null}
								</div>
							</details>
						);
					}
					const { event } = entry;
					if (event.kind === "thinking") {
						return (
							<details key={event.seq} className="engine-commander__process">
								<summary>
									<time className="engine-commander__time">{clock(event.at)}</time>
									<span>{t("思考")}</span>
									<span className="engine-commander__preview">
										{t("{count} 字", { count: (event.text ?? "").length })}
									</span>
								</summary>
								<div className="engine-commander__details">
									<pre>{event.text}</pre>
								</div>
							</details>
						);
					}
					if (event.kind === "text") {
						return (
							<div
								key={event.seq}
								className={
									event.from === "operator" ? "engine-commander__message is-operator" : "engine-commander__message"
								}
							>
								<div className="engine-commander__meta">
									<span>{event.from === "operator" ? t("你") : t("指挥官")}</span>
									<time>{clock(event.at)}</time>
								</div>
								<p>{event.text}</p>
							</div>
						);
					}
					return (
						<div
							key={event.seq}
							className={event.status === "error" ? "engine-commander__note is-error" : "engine-commander__note"}
						>
							{event.note ?? event.status ?? ""}
						</div>
					);
				})}
			</div>
			<div className="engine-commander__composer">
				<Input.TextArea
					autoSize={{ minRows: 2, maxRows: 5 }}
					variant="borderless"
					aria-label={t("给指挥官的指令")}
					value={draft}
					disabled={!canChat}
					placeholder={
						status === "running"
							? t("向指挥官补充目标或调整方向…")
							: status === "completed"
								? t("工程已完成，向指挥官追问报告细节…")
								: t("工程未运行，暂时不能对话")
					}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
							event.preventDefault();
							sendDraft();
						}
					}}
				/>
				<div className="engine-commander__composer-actions">
					<Text type="secondary">{t("Enter 发送 · Shift+Enter 换行")}</Text>
					<Button size="small" type="primary" disabled={!canChat || !draft.trim()} onClick={sendDraft}>
						{t("发送")}
					</Button>
				</div>
			</div>
		</section>
	);
}

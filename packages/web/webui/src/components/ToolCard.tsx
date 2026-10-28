import { CopyOutlined, DownOutlined, ExpandOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Card, Input, Modal, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";

const { Text } = Typography;

/** First non-empty line of a text block, truncated for the collapsed summary row. */
function summaryLine(text: string, max = 110): string {
	const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
	return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** Last non-empty line, so a running command shows where it got to. */
function tailLine(text: string, max = 110): string {
	const lines = text.split("\n").filter((candidate) => candidate.trim().length > 0);
	const line = lines[lines.length - 1] ?? "";
	return line.length > max ? `…${line.slice(-max)}` : line;
}

function durationLabel(durationMs: number | undefined): string {
	return durationMs !== undefined ? `${(durationMs / 1000).toFixed(1)}s` : "";
}

const STATUS_COLORS: Record<"running" | "done" | "error", string> = {
	running: "processing",
	done: "success",
	error: "error",
};

/**
 * One tool call. Collapsed it is a quiet row in the run's timeline: the tool
 * name, one line of the command or its latest output, and the outcome on the
 * right. Expanded it becomes the dark terminal block, because that is where raw
 * output belongs.
 */
export function ToolCard({
	name,
	status,
	time,
	durationMs,
	command,
	output,
	onFullscreen,
}: {
	name: string;
	status: "running" | "done" | "error";
	/** Wall-clock time of the call, so a live card reads like a finished step. */
	time?: string;
	durationMs?: number;
	command?: string;
	output: string;
	onFullscreen?: (command: string | undefined, output: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState<"command" | "output" | null>(null);

	const copy = async (kind: "command" | "output", text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(kind);
			window.setTimeout(() => setCopied(null), 1500);
		} catch {
			// Clipboard permission denied; ignore.
		}
	};

	const toggle = () => setExpanded((prev) => !prev);
	const onBarKey = (event: React.KeyboardEvent) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			toggle();
		}
	};
	// Running calls show where they got to; finished ones show what was run.
	const preview =
		status === "running" ? tailLine(output) || summaryLine(command ?? "") : summaryLine(command || output);
	const duration = durationLabel(durationMs);
	const statusLabel = status === "running" ? t("运行中") : status === "error" ? t("失败") : t("完成");

	if (!expanded) {
		return (
			<div
				className={`toolcard is-${status}`}
				role="button"
				tabIndex={0}
				onClick={toggle}
				onKeyDown={onBarKey}
			>
				{time ? (
					<Text type="secondary" className="toolcard__time">
						{time}
					</Text>
				) : null}
				<Tag variant="filled" className="toolcard__name">
					{name}
				</Tag>
				{preview ? (
					<Text type="secondary" ellipsis className="toolcard__summary">
						{preview}
					</Text>
				) : null}
				<Tag color={STATUS_COLORS[status]} variant="filled" className="toolcard__status">
					{statusLabel}
					{duration ? ` ${duration}` : ""}
				</Tag>
				<RightOutlined className="toolcard__caret" />
			</div>
		);
	}

	return (
		<div className={`toolcard is-${status} is-open`}>
			<Card
				size="small"
				className="toolcard__panel"
				title={
					<span className="toolcard__title" role="button" tabIndex={0} onClick={toggle} onKeyDown={onBarKey}>
						<DownOutlined />
						<Tag variant="filled">{name}</Tag>
						<Tag color={STATUS_COLORS[status]} variant="filled">
							{status === "running" ? t("执行中…") : status === "error" ? t("出错") : t("完成")}
							{duration ? ` ${duration}` : ""}
						</Tag>
					</span>
				}
				extra={
					<Space size={4}>
						{command ? (
							<Button
								type="text"
								size="small"
								icon={<CopyOutlined />}
								onClick={() => void copy("command", command)}
							>
								{copied === "command" ? t("已复制") : t("复制命令")}
							</Button>
						) : null}
						{output ? (
							<>
								<Button
									type="text"
									size="small"
									icon={<CopyOutlined />}
									onClick={() => void copy("output", output)}
								>
									{copied === "output" ? t("已复制") : t("复制输出")}
								</Button>
								{onFullscreen ? (
									<Button
										type="text"
										size="small"
										icon={<ExpandOutlined />}
										onClick={() => onFullscreen(command, output)}
									>
										{t("全屏")}
									</Button>
								) : null}
							</>
						) : null}
					</Space>
				}
			>
				{command ? <pre className="toolcard__pre">{command}</pre> : null}
				{output ? (
					<pre className="toolcard__pre">{output}</pre>
				) : (
					<pre className="toolcard__pre is-empty">
						{status === "running" ? t("等待输出…") : t("（无输出）")}
					</pre>
				)}
			</Card>
		</div>
	);
}

export function OutputViewer({ title, output, onClose }: { title: string; output: string; onClose: () => void }) {
	const [query, setQuery] = useState("");
	const lines = output.split("\n");
	const matched = query
		? lines
				.map((line, index) => ({ line, index }))
				.filter(({ line }) => line.toLowerCase().includes(query.toLowerCase()))
		: null;

	return (
		<Modal open title={title} footer={null} onCancel={onClose} width={920} className="output-viewer" destroyOnHidden>
			<div className="viewer-toolbar">
				<Input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t("搜索输出（过滤匹配行）…")}
					spellCheck={false}
					allowClear
				/>
				<Text type="secondary" className="viewer-count">
					{matched
						? t("{matched}/{total} 行匹配", { matched: matched.length, total: lines.length })
						: t("{count} 行", { count: lines.length })}
				</Text>
			</div>
			<pre className="viewer-body">
				{matched
					? matched.map(({ line, index }) => (
							<div key={index}>
								<span className="line-number">{index + 1}</span>
								{line}
							</div>
						))
					: output}
			</pre>
		</Modal>
	);
}

/**
 * The command approval queue.
 *
 * A modal, not a page: a run is blocked until these are decided, so the queue
 * has to sit on top of whatever the operator is doing. Each request is its own
 * card because the command can be edited before approval — the textarea is the
 * command that will actually run, and the prefix that "always allow" would
 * record is derived from that edited text, not from the original.
 */

import { Button, Card, Checkbox, Input, Modal, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";
import type { SentinelApprovalRequest } from "../types.ts";

const { Text } = Typography;

function commandPrefix(command: string): string {
	const trimmed = command.trim();
	const index = trimmed.search(/\s/);
	return index === -1 ? trimmed : trimmed.slice(0, index);
}

function approvalSource(source: string): string {
	if (source === "子代理") return t("子代理来源");
	const task = /^工程任务「(.+)」$/.exec(source);
	if (task) return t("工程任务「{name}」", { name: task[1] ?? "" });
	return source;
}

function ApprovalRow({
	request,
	index,
	total,
	onDecide,
}: {
	request: SentinelApprovalRequest;
	index: number;
	total: number;
	onDecide: (id: string, approved: boolean, command: string, alwaysAllowPrefix: boolean) => void;
}) {
	const [command, setCommand] = useState(request.command);
	const [alwaysAllow, setAlwaysAllow] = useState(false);
	const prefix = commandPrefix(command);
	const edited = command !== request.command;

	return (
		<Card
			size="small"
			className="approval-card"
			title={
				<Space size={8} wrap>
					<span>{t("请求 {index} / {total}", { index, total })}</span>
					<Tag variant="filled">{request.source ? approvalSource(request.source) : t("未知来源")}</Tag>
					{edited ? (
						<Tag color="orange" variant="filled">
							{t("命令已修改")}
						</Tag>
					) : null}
				</Space>
			}
		>
			<Text type="secondary" className="approval-label">
				{edited ? t("将要执行的命令（已编辑）") : t("将要执行的命令")}
			</Text>
			<Input.TextArea
				className="approval-command"
				value={command}
				onChange={(event) => setCommand(event.target.value)}
				autoSize={{ minRows: 3, maxRows: 8 }}
				spellCheck={false}
			/>
			<div className="approval-meta">
				<div className="approval-cwd">
					<Text type="secondary">{t("执行目录")}</Text>
					<Text code title={request.cwd} className="approval-cwd__path">
						{request.cwd}
					</Text>
				</div>
				<Checkbox checked={alwaysAllow} onChange={(event) => setAlwaysAllow(event.target.checked)}>
					{t("本会话自动放行以此开头的命令")}
					<Text code>{prefix || t("空命令")}</Text>
				</Checkbox>
			</div>
			<div className="approval-actions">
				<Button type="primary" onClick={() => onDecide(request.id, true, command, alwaysAllow)}>
					{t("批准执行")}
				</Button>
				<Button danger onClick={() => onDecide(request.id, false, command, false)}>
					{t("拒绝")}
				</Button>
			</div>
		</Card>
	);
}

export function ApprovalQueue({
	requests,
	onDecide,
	onDecideAll,
}: {
	requests: SentinelApprovalRequest[];
	onDecide: (id: string, approved: boolean, command: string, alwaysAllowPrefix: boolean) => void;
	onDecideAll: (approved: boolean) => void;
}) {
	return (
		<Modal
			open
			title={
				<Space size={8}>
					<span>{t("命令审批")}</span>
					<Tag color="red" variant="filled">
						{t("{count} 条待审", { count: requests.length })}
					</Tag>
				</Space>
			}
			width={760}
			footer={null}
			closable={false}
			keyboard={false}
			maskClosable={false}
			className="approval-modal"
		>
			{requests.length > 1 ? (
				<Space className="approval-bulk" size={8}>
					<Button type="primary" onClick={() => onDecideAll(true)}>
						{t("全部批准（按原命令）")}
					</Button>
					<Button danger onClick={() => onDecideAll(false)}>
						{t("全部拒绝")}
					</Button>
				</Space>
			) : null}

			<div className="approval-list">
				{requests.map((request, index) => (
					<ApprovalRow
						key={request.id}
						request={request}
						index={index + 1}
						total={requests.length}
						onDecide={onDecide}
					/>
				))}
			</div>

			<Text type="secondary" className="approval-hint">
				{t("复合命令（含 &&、;、| 等）不会命中前缀白名单，始终需要人工审批。")}
			</Text>
		</Modal>
	);
}

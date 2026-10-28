/**
 * The dialog that starts a persistent goal.
 *
 * Everything the driver needs to bound the run is asked for here, because none of
 * it can be changed later without starting over: the objective, the acceptance
 * criteria the completion has to answer one by one, and the round budget. The
 * budget defaults to three continuations, which is the operator's stated
 * preference: three automatic rounds, then stop and ask.
 */

import { Alert, Form, Input, InputNumber, Modal, Typography } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";

const { Text } = Typography;

export const DEFAULT_GOAL_ROUNDS = 3;
const MAX_GOAL_ROUNDS = 99;

/** Acceptance criteria: one per line, numbering and duplicates dropped. */
function parseCriteria(text: string): string[] {
	const seen = new Set<string>();
	const criteria: string[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.replace(/^[-*\d.、)\s]+/, "").trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		criteria.push(trimmed);
	}
	return criteria.slice(0, 20);
}

export function GoalStartDialog({
	onClose,
	onStart,
}: {
	onClose: () => void;
	/** Hands the goal to the server; the dialog closes immediately, errors arrive as a toast. */
	onStart: (objective: string, criteria: string[], roundLimit: number) => void;
}) {
	const [objective, setObjective] = useState("");
	const [criteria, setCriteria] = useState("");
	const [rounds, setRounds] = useState(DEFAULT_GOAL_ROUNDS);

	const limit = Number.isFinite(rounds)
		? Math.min(MAX_GOAL_ROUNDS, Math.max(1, Math.round(rounds)))
		: DEFAULT_GOAL_ROUNDS;
	const canSubmit = objective.trim().length > 0;
	const submit = () => {
		if (!canSubmit) return;
		onStart(objective.trim(), parseCriteria(criteria), limit);
		onClose();
	};

	return (
		<Modal
			open
			width={640}
			title={t("持续目标")}
			okText={t("提交并启动")}
			cancelText={t("取消")}
			okButtonProps={{ disabled: !canSubmit }}
			onOk={submit}
			onCancel={onClose}
			destroyOnHidden
		>
			<Alert
				type="warning"
				showIcon
				className="ui-page__alert"
				title={`${t("一轮结束后自动继续，直到模型调用 goal_complete 证明达成目标，或达到轮数上限。只在自动模式下可用：")} ${t("运行期间所有命令无人拦截直接执行。")}`}
			/>
			<Form layout="vertical" requiredMark={false}>
				<Form.Item label={t("目标（必填）")} required>
					<Input.TextArea
						value={objective}
						autoSize={{ minRows: 4, maxRows: 10 }}
						placeholder={t("例如：对 10.10.10.5 完成全端口侦察，确认服务与版本，并把确认的问题提交到漏洞中枢")}
						onChange={(event) => setObjective(event.target.value)}
					/>
				</Form.Item>
				<Form.Item label={t("验收标准（选填，一行一条；填了就必须在完成时逐条给出证据）")}>
					<Input.TextArea
						value={criteria}
						autoSize={{ minRows: 3, maxRows: 8 }}
						placeholder={t("例如：\n开放端口已全部确认服务与版本\n发现的问题已提交漏洞中枢")}
						onChange={(event) => setCriteria(event.target.value)}
					/>
				</Form.Item>
				<Form.Item
					label={t("自动续跑轮数上限")}
					extra={t("初始运行不计入；到上限后暂停，可在目标条上点「继续 +3 轮」。")}
				>
					<InputNumber
						min={1}
						max={MAX_GOAL_ROUNDS}
						value={rounds}
						style={{ width: 160 }}
						onChange={(value) => setRounds(value ?? DEFAULT_GOAL_ROUNDS)}
					/>
				</Form.Item>
			</Form>
			<Text type="secondary">{t("目标运行期间所有命令无人拦截直接执行，请确认目标与范围。")}</Text>
		</Modal>
	);
}

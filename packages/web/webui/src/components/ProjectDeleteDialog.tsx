/**
 * The delete confirmation for one project.
 *
 * The two scopes are the two buttons: nothing is preselected, so the operator
 * reads what each one does and the click itself is the choice. Both stay
 * disabled until the full project name is typed, which is what makes an
 * irreversible deletion deliberate without adding a second step.
 */

import { Button, Input, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";
import type { SentinelProjectInfo } from "../types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const { Text } = Typography;

/**
 * What the confirmation offers, in the order it shows them: the safe scope
 * first, the destructive one in solid red.
 */
export const PROJECT_REMOVE_OPTIONS: readonly {
	scope: "container" | "data";
	label: string;
	danger: boolean;
}[] = [
	{ scope: "container", label: t("仅删除容器"), danger: false },
	{ scope: "data", label: t("删除项目数据"), danger: true },
];

/** Whether the typed name matches the project, which is what unlocks both actions. */
export function deleteConfirmMatches(confirmName: string, projectName: string): boolean {
	return confirmName.trim() === projectName;
}

export function ProjectDeleteDialog({
	project,
	busy = false,
	sessionCount,
	onConfirm,
	onCancel,
}: {
	project: SentinelProjectInfo;
	busy?: boolean;
	sessionCount?: number;
	onConfirm: (scope: "container" | "data") => void;
	onCancel: () => void;
}) {
	const [confirmName, setConfirmName] = useState("");
	const matches = deleteConfirmMatches(confirmName, project.name);

	return (
		<ConfirmDialog
			title={t("删除项目")}
			subtitle={project.name}
			onCancel={onCancel}
			footer={
				<>
					{PROJECT_REMOVE_OPTIONS.map((entry) => (
						<Button
							key={entry.scope}
							type={entry.danger ? "primary" : "default"}
							danger={entry.danger}
							disabled={busy || !matches}
							onClick={() => onConfirm(entry.scope)}
						>
							{entry.label}
						</Button>
					))}
				</>
			}
		>
			<Space size={6} wrap className="confirm-meta">
				<Text type="secondary">{t("容器")}</Text>
				<Text code>{project.container ?? t("无容器")}</Text>
				{sessionCount === undefined ? null : (
					<Text type="secondary">{t("{count} 个会话", { count: sessionCount })}</Text>
				)}
				<Text type="secondary">{t("{count} 条漏洞记录", { count: project.vulnCount ?? 0 })}</Text>
				<Text type="secondary">{t("{count} 条资产库记录", { count: project.assetCount ?? 0 })}</Text>
				<Text type="secondary">{t("{count} 条审批记录", { count: project.gateCount ?? 0 })}</Text>
			</Space>
			<Text type="secondary" className="confirm-note">
				{t("仅删除容器只删掉容器本身，项目、工作目录、会话与记录都保留，下次「启动容器」按当前设置重建；")}
				{t("删除项目数据会连项目条目、工作目录 /work 里的文件、会话文件与漏洞/资产库/审批等记录一起删除，不可恢复。")}
			</Text>
			<div className="confirm-field">
				<Space size={6}>
					<Text>{t("输入项目名 {name} 以确认", { name: project.name })}</Text>
					{matches ? (
						<Tag color="green" variant="filled">
							{t("已确认")}
						</Tag>
					) : null}
				</Space>
				<Input
					value={confirmName}
					placeholder={project.name}
					spellCheck={false}
					/* biome-ignore lint/a11y/noAutofocus: the dialog exists to type this name */
					autoFocus
					onChange={(event) => setConfirmName(event.target.value)}
				/>
			</div>
		</ConfirmDialog>
	);
}

/**
 * The 业务建模 menu: one composer entry for both modeling actions.
 *
 * 开始建模 runs the two-tool cycle on this conversation (or ends the run in
 * force); 关联建模数据 attaches existing records to a fresh conversation. The
 * attach checklist lives inside the same menu as a second view, because the two
 * actions are one feature, not two switches.
 *
 * Like the preset picker it is portaled to document.body with fixed
 * coordinates: the composer sits at the bottom of the window where a plain
 * dropdown would clip.
 */

import { Button, Checkbox, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";
import type { SentinelApiModelSummary, SentinelModelingState } from "../types.ts";
import { PickerShell, type PickerAnchor } from "../ui/PickerShell.tsx";

const { Text } = Typography;

type PresetMenuAnchor = PickerAnchor;

export function ModelingMenu(props: {
	anchor: PresetMenuAnchor;
	/** The run in force for this conversation, if any: the first item ends it. */
	modeling: SentinelModelingState | null;
	/** Records this conversation already carries; shown with a removal action. */
	attached: ReadonlyArray<{ id: string; title: string }>;
	/** The project's records, offered for attaching on a fresh conversation. */
	records: readonly SentinelApiModelSummary[];
	selected: readonly string[];
	/** Attaching rides the first message, so an ongoing conversation cannot do it. */
	canAttach: boolean;
	/** 开始建模 needs a settled session; 结束建模 the same. */
	canToggleRun: boolean;
	onStart(): void;
	onEnd(): void;
	onToggle(id: string): void;
	onDetach(): void;
	onClose(): void;
}) {
	const [view, setView] = useState<"actions" | "attach">("actions");
	return (
		<PickerShell
			anchor={props.anchor}
			title={t("业务建模")}
			width={320}
			className="modeling-menu"
			onClose={props.onClose}
		>
			{view === "actions" ? (
				<>
					{props.modeling ? (
						<Button
							type="text"
							block
							className="pickmenu__action"
							disabled={!props.canToggleRun}
							title={
								props.canToggleRun
									? t("结束这次建模，Agent 回到普通工作")
									: t("Agent 正在运行，先中止或等本轮结束")
							}
							onClick={() => {
								props.onEnd();
								props.onClose();
							}}
						>
							<span className="pickmenu__item-text">
								<Text strong>{t("结束建模")}</Text>
								<Text type="secondary">
									{props.modeling.title} ·{" "}
									{t("{pathCount} 路径 / {operationCount} 操作", {
										pathCount: props.modeling.pathCount,
										operationCount: props.modeling.operationCount,
									})}
								</Text>
							</span>
						</Button>
					) : (
						<Button
							type="text"
							block
							className="pickmenu__action"
							disabled={!props.canToggleRun}
							title={
								props.canToggleRun
									? t("在当前会话里还原目标的接口与业务实体，生成 Swagger 文档")
									: t("Agent 正在运行，先中止或等本轮结束")
							}
							onClick={() => {
								props.onStart();
								props.onClose();
							}}
						>
							<span className="pickmenu__item-text">
								<Text strong>{t("开始建模")}</Text>
								<Text type="secondary">
									{t("在本会话里还原接口与业务实体；在对话里直接要求也可以")}
								</Text>
							</span>
						</Button>
					)}
					<Button
						type="text"
						block
						className="pickmenu__action"
						disabled={!props.canAttach && props.attached.length === 0}
						title={
							props.attached.length > 0
								? t("查看本会话已带入的建模数据，或全部移除")
								: props.canAttach
									? t("勾选已有建模记录，随第一条消息把接口目录交给 Agent")
									: t("只有还没有发过消息的新对话可以关联建模数据")
						}
						onClick={() => setView("attach")}
					>
						<Space size={6}>
							<Text strong>{t("关联建模数据")}</Text>
							{props.attached.length > 0 ? (
								<Tag color="blue" variant="filled">
									{t("{count} 份", { count: props.attached.length })}
								</Tag>
							) : null}
						</Space>
						<Text type="secondary" className="pickmenu__item-desc">
							{props.attached.length > 0
								? t("目录已注入，api_model_read 可读全文")
								: props.canAttach
									? t("把已有记录的接口目录带进这条新对话")
									: t("仅新对话可用")}
						</Text>
					</Button>
				</>
			) : (
				<>
					<Space size={8} align="center">
						<Button size="small" type="link" onClick={() => setView("actions")}>
							‹ {t("返回")}
						</Button>
						<Text strong>{t("关联建模数据")}</Text>
					</Space>
					{props.attached.length > 0 ? (
						<>
							{props.attached.map((record) => (
								<div key={record.id} className="pickmenu__item">
									<div className="pickmenu__item-text">
										<Text strong>{record.title}</Text>
										<Text type="secondary">{t("目录已注入，api_model_read 可读全文")}</Text>
									</div>
								</div>
							))}
							<Button danger size="small" block onClick={props.onDetach}>
								{t("全部移除（摘除 api_model_read）")}
							</Button>
						</>
					) : (
						<>
							{props.records.map((record) => (
								<div
									key={record.id}
									className="pickmenu__item pickmenu__item--row"
									onClick={() => props.onToggle(record.id)}
									title={t("{pathCount} 路径 / {operationCount} 操作", {
										pathCount: record.pathCount,
										operationCount: record.operationCount,
									})}
								>
									<Checkbox checked={props.selected.includes(record.id)} />
									<div className="pickmenu__item-text">
										<Text strong>{record.title}</Text>
										<Text type="secondary">
											{t("{pathCount} 路径 · {operationCount} 操作 · {entityCount} 实体", {
												pathCount: record.pathCount,
												operationCount: record.operationCount,
												entityCount: record.entityCount,
											})}
										</Text>
									</div>
								</div>
							))}
							{props.records.length === 0 ? (
								<Text type="secondary" className="pickmenu__hint">
									{t("这个项目还没有业务建模记录。先开始一次建模。")}
								</Text>
							) : (
								<Text type="secondary" className="pickmenu__hint">
									{t("勾选后随第一条消息把接口目录交给 Agent（细节它可用 api_model_read 自己查）；一条都不勾，就什么都不插入。发送后勾选自动清空。")}
								</Text>
							)}
						</>
					)}
				</>
			)}
		</PickerShell>
	);
}

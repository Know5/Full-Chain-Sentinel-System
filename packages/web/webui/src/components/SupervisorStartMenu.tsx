/**
 * The supervisor arming menu. It deliberately uses the preset-menu shell and
 * portal/fixed anchoring: the composer lives inside clipped scroll panels, so an
 * absolutely positioned menu can be cut off at the panel edge.
 */

import { Button, Input, Segmented, Space, Tag, Typography } from "antd";
import { t } from "../i18n.ts";
import { SUPERVISOR_STRATEGY_OPTIONS } from "../supervisor-strategy.ts";
import type {
	SentinelSupervisorCustomStrategy,
	SentinelSupervisorMode,
	SentinelSupervisorStrategyRef,
} from "../types.ts";
import { PickerShell, type PickerAnchor } from "../ui/PickerShell.tsx";

const { Text } = Typography;

type PresetMenuAnchor = PickerAnchor;

export type SupervisorLaunchMode = "observe" | "auto" | "confirm";

const MODES: Array<{ value: SupervisorLaunchMode; label: string; description: string }> = [
	{ value: "observe", label: t("观察"), description: t("只记录和总结，不改主 Agent") },
	{ value: "auto", label: t("自动发送"), description: t("判断停滞或循环时直接给建议") },
	{ value: "confirm", label: t("确认后发送"), description: t("建议先到悬浮窗，由你决定是否发送") },
];

export function SupervisorStartMenu({
	anchor,
	mode,
	strategies,
	customStrategies,
	note,
	onModeChange,
	onToggleStrategy,
	onNoteChange,
	onStart,
	onClose,
}: {
	anchor: PresetMenuAnchor;
	mode: SupervisorLaunchMode;
	strategies: SentinelSupervisorStrategyRef[];
	customStrategies: SentinelSupervisorCustomStrategy[];
	note: string;
	onModeChange: (mode: SupervisorLaunchMode) => void;
	onToggleStrategy: (ref: SentinelSupervisorStrategyRef) => void;
	onNoteChange: (note: string) => void;
	onStart: () => void;
	onClose: () => void;
}) {
	const isSelected = (ref: SentinelSupervisorStrategyRef): boolean =>
		strategies.some((entry) =>
			ref.customStrategyId
				? entry.customStrategyId === ref.customStrategyId
				: !entry.customStrategyId && entry.strategy === ref.strategy,
		);
	const selected = strategies.map((ref) => {
		const custom = ref.customStrategyId
			? customStrategies.find((entry) => entry.id === ref.customStrategyId)
			: undefined;
		const option = SUPERVISOR_STRATEGY_OPTIONS.find((entry) => entry.id === ref.strategy);
		return {
			key: ref.customStrategyId ? `custom:${ref.customStrategyId}` : `preset:${ref.strategy}`,
			name: custom?.name ?? option?.label ?? t("监督策略"),
			description: custom?.description ?? option?.hint ?? "",
			instructions: custom?.instructions ?? "",
		};
	});
	const title =
		selected.length > 1
			? t("{count} 个监督策略", { count: selected.length })
			: (selected[0]?.name ?? t("监督策略"));
	const description =
		selected.length > 1
			? t("多个策略会合并到同一份监督判断中；冲突时以安全规则和补充说明为准。")
			: (selected[0]?.description ?? "");
	const selectedMode = MODES.find((entry) => entry.value === mode) ?? MODES[0];

	return (
		<PickerShell
			anchor={anchor}
			title={t("开启监督")}
			subtitle={t("方式 · 策略 · 说明")}
			width={460}
			className="supervisor-menu"
			onClose={onClose}
			footer={
				<Space size={8} wrap className="pickmenu__footrow">
					<Text type="secondary">{t("可多选，至少保留一个；策略不会放宽安全规则")}</Text>
					<Button type="primary" size="small" onClick={onStart} disabled={strategies.length === 0}>
						{strategies.length === 0 ? t("至少选择一个策略") : t("开始监督")}
					</Button>
				</Space>
			}
		>
			<Segmented
				size="small"
				block
				value={mode}
				onChange={(value) => onModeChange(value as SupervisorLaunchMode)}
				options={MODES.map((entry) => ({ value: entry.value, label: entry.label }))}
			/>
			<Text type="secondary" className="pickmenu__hint">
				{selectedMode?.description}
			</Text>

			<Space size={6} wrap className="supervisor-menu__nav">
				{SUPERVISOR_STRATEGY_OPTIONS.map((option) => {
					const ref: SentinelSupervisorStrategyRef = { strategy: option.id, customStrategyId: null };
					return (
						<Button
							key={option.id}
							size="small"
							type={isSelected(ref) ? "primary" : "default"}
							onClick={() => onToggleStrategy(ref)}
						>
							{option.label}
						</Button>
					);
				})}
			</Space>
			{customStrategies.length > 0 ? (
				<>
					<Text type="secondary">{t("自定义")}</Text>
					<Space size={6} wrap className="supervisor-menu__nav">
						{customStrategies.map((custom) => {
							const ref: SentinelSupervisorStrategyRef = {
								strategy: custom.base,
								customStrategyId: custom.id,
							};
							return (
								<Button
									key={custom.id}
									size="small"
									type={isSelected(ref) ? "primary" : "default"}
									onClick={() => onToggleStrategy(ref)}
								>
									{custom.name}
								</Button>
							);
						})}
					</Space>
				</>
			) : null}

			<Text strong>{title}</Text>
			<Text type="secondary">{description}</Text>
			{selected.length > 1 ? (
				<Space size={6} wrap>
					{selected.map((entry) => (
						<Tag key={entry.key} variant="filled" title={entry.instructions || entry.description}>
							{entry.name}
						</Tag>
					))}
				</Space>
			) : null}
			<Text type="secondary">{t("补充说明 · 可选")}</Text>
			<Input.TextArea
				value={note}
				maxLength={200}
				rows={2}
				onChange={(event) => onNoteChange(event.target.value)}
				placeholder={t("例如：只允许测试 10.0.0.5，禁止删除业务数据")}
			/>
		</PickerShell>
	);
}

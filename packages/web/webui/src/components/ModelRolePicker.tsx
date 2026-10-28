import { Button, Modal, Radio, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";
import type {
	SentinelModelLibraryView,
	SentinelModelRoleName,
	SentinelTestResult,
} from "../types.ts";

import {
	FOLLOW_MAIN,
	hostOf,
	ModelStatusTag,
	ROLE_HINTS,
	ROLE_LABELS,
	testDetail,
	testState,
	UsageTags,
} from "./model-ui.tsx";

const { Text } = Typography;

/**
 * A role only ever points at a library entry (or at 主模型); editing the model
 * itself lives in the drawer. Keeping assignment in a small dialog means the
 * cockpit never grows a second full editor.
 */
export function ModelRolePicker({
	library,
	role,
	results,
	onApply,
	onClose,
}: {
	library: SentinelModelLibraryView;
	role: SentinelModelRoleName;
	results: Record<string, SentinelTestResult | null>;
	onApply: (target: string | null) => void;
	onClose: () => void;
}) {
	const current = role === "main" ? library.roles.main : library.roles[role];
	const [selected, setSelected] = useState<string>(current ?? "");
	const resolved = library.resolved[role];
	const mainEntry = library.entries.find((entry) => entry.id === library.roles.main);

	const options = [
		...(role === "main"
			? [
					{
						value: "",
						title: t("未选择"),
						detail: t("主模型未配置时，依赖它的角色也无法解析"),
						entry: null,
					},
				]
			: [
					{
						value: FOLLOW_MAIN,
						title: t("跟随主模型"),
						detail: mainEntry
							? t("使用 {name} · {model}", { name: mainEntry.name, model: mainEntry.modelId })
							: t("主模型尚未配置"),
						entry: null,
					},
				]),
		...library.entries.map((entry) => ({
			value: entry.id,
			title: `${entry.name} · ${entry.modelId}`,
			detail: hostOf(entry.baseUrl),
			entry,
		})),
	];

	return (
		<Modal
			open
			width={640}
			title={t("更换{role}", { role: ROLE_LABELS[role] })}
			okText={t("应用")}
			cancelText={t("取消")}
			onOk={() => onApply(selected === "" ? null : selected)}
			onCancel={onClose}
			destroyOnHidden
			className="rolepicker"
		>
			<Text type="secondary">{t("{hint} · 同一模型可被多个角色复用", { hint: ROLE_HINTS[role] })}</Text>
			<Text type="secondary" className="rolepicker__current">
				{t("当前：{target}", {
					target: resolved ? `${resolved.entryName} · ${resolved.modelId}` : t("未绑定"),
				})}
			</Text>
			<Radio.Group
				className="rolepicker__options"
				value={selected}
				onChange={(event) => setSelected(String(event.target.value))}
			>
				<Space orientation="vertical" size={8} style={{ width: "100%" }}>
					{options.map((option) => (
						<Radio
							key={option.value || "none"}
							value={option.value}
							className={selected === option.value ? "rolepicker__option is-on" : "rolepicker__option"}
						>
							<div className="rolepicker__option-text">
								<Text strong>{option.title}</Text>
								<Text type="secondary">{option.detail}</Text>
							</div>
							{option.entry ? (
								<Space size={4} wrap className="rolepicker__tags">
									<UsageTags roles={option.entry.roles} />
									<ModelStatusTag
										state={testState(false, results[option.entry.id])}
										detail={testDetail(results[option.entry.id])}
									/>
								</Space>
							) : null}
						</Radio>
					))}
				</Space>
			</Radio.Group>
			<Text type="secondary" className="rolepicker__hint">
				{t("更多模型在「模型库」中添加")}
			</Text>
		</Modal>
	);
}

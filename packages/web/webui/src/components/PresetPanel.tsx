/**
 * 设置 → 预设 Agent.
 *
 * A preset is system-prompt context, not capability: the page says so up front,
 * because an operator who expects a preset to bring tools will otherwise assume
 * the switches below are broken. The library is always operator-created, so the
 * empty state explains where presets come from instead of offering a sample.
 */

import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import type { ProColumns } from "@ant-design/pro-components";
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Switch, Tag, Typography } from "antd";
import { useRef, useState } from "react";
import { t } from "../i18n.ts";
import type { SentinelClientMessage, SentinelPresetView } from "../types.ts";

const { Text } = Typography;

/** Body-size thresholds at which the token figure turns yellow, then red. */
const TOKEN_WARN = 2000;
const TOKEN_DANGER = 8000;

/** The 导入 reply, shown inline instead of as a browser alert. */
export interface PresetImportNotice {
	imported: number;
	skipped: { name: string; reason: string }[];
}

type SavePresetInput = Extract<SentinelClientMessage, { type: "save_preset" }>["input"];

interface Draft {
	/** Set when editing an existing preset; absent when creating one. */
	id?: string;
	name: string;
	description: string;
	tags: string;
	placeholder: string;
	text: string;
}

const EMPTY_DRAFT: Draft = { name: "", description: "", tags: "", placeholder: "", text: "" };

function draftOf(preset: SentinelPresetView): Draft {
	return {
		id: preset.id,
		name: preset.name,
		description: preset.description,
		tags: preset.tags.join(", "),
		placeholder: preset.placeholder,
		text: preset.text,
	};
}

function tokenColor(tokens: number): string {
	if (tokens >= TOKEN_DANGER) return "red";
	if (tokens >= TOKEN_WARN) return "orange";
	return "default";
}

export function PresetPanel({
	presets,
	importNotice,
	onSave,
	onDelete,
	onSetEnabled,
	onExport,
	onImport,
}: {
	presets: SentinelPresetView[] | null;
	importNotice: PresetImportNotice | null;
	onSave: (input: SavePresetInput) => void;
	onDelete: (id: string) => void;
	onSetEnabled: (id: string, enabled: boolean) => void;
	onExport: () => void;
	onImport: (content: string) => void;
}) {
	const [draft, setDraft] = useState<Draft | null>(null);
	const fileRef = useRef<HTMLInputElement | null>(null);

	const submit = () => {
		if (!draft) return;
		const name = draft.name.trim();
		// The body may be any length, but an empty one saves a preset that does
		// nothing; the server refuses it too, so the button stays disabled instead.
		if (!name || !draft.text.trim()) return;
		onSave({
			...(draft.id ? { id: draft.id } : {}),
			name,
			description: draft.description.trim(),
			tags: draft.tags
				.split(/[,，]/)
				.map((tag) => tag.trim())
				.filter(Boolean),
			placeholder: draft.placeholder.trim(),
			text: draft.text,
		});
		setDraft(null);
	};

	if (!presets) {
		return <Text type="secondary">{t("正在读取预设 Agent…")}</Text>;
	}

	const columns: ProColumns<SentinelPresetView>[] = [
		{
			title: t("名称"),
			dataIndex: "name",
			key: "name",
			width: 220,
			render: (_, preset) => (
				<Space size={6} wrap>
					<Text strong>{preset.name}</Text>
					{preset.textMissing ? (
						<Tag
							color="error"
							variant="filled"
							title={t("正文文件 presets/<id>.md 已丢失：该预设当前不可用，需重新编写并保存才能恢复")}
						>
							{t("正文缺失")}
						</Tag>
					) : null}
				</Space>
			),
		},
		{
			title: t("一句话描述"),
			dataIndex: "description",
			key: "description",
			ellipsis: { showTitle: true },
			render: (_, preset) =>
				preset.textMissing ? (
					<Text type="danger">{t("正文文件已丢失，该预设不可用，需重新编写正文并保存")}</Text>
				) : (
					<Text type="secondary">{preset.description || t("（未填写）")}</Text>
				),
		},
		{
			title: t("标签"),
			dataIndex: "tags",
			key: "tags",
			width: 220,
			render: (_, preset) =>
				preset.tags.length === 0 ? (
					<Text type="secondary">{t("无标签")}</Text>
				) : (
					<Space size={4} wrap>
						{preset.tags.map((tag) => (
							<Tag key={tag} color="blue" variant="filled">
								{tag}
							</Tag>
						))}
					</Space>
				),
		},
		{
			title: t("估算 token"),
			key: "tokens",
			width: 150,
			render: (_, preset) => (
				<Tag color={tokenColor(preset.tokens)} variant="filled" title={t("按字符粗略估算，用于发现过大的预设")}>
					{t("粗估 {count} tokens", { count: preset.tokens })}
				</Tag>
			),
		},
		{
			title: t("状态"),
			key: "enabled",
			width: 140,
			render: (_, preset) => (
				<Space size={6}>
					<Switch
						size="small"
						checked={preset.enabled}
						title={t("停用后新建会话与工程派发都不再选它；已在运行的会话不受影响")}
						onChange={(checked) => onSetEnabled(preset.id, checked)}
					/>
					<Tag color={preset.enabled ? "green" : "default"} variant="filled">
						{preset.enabled ? t("已启用") : t("已停用")}
					</Tag>
				</Space>
			),
		},
		{
			title: t("操作"),
			key: "actions",
			width: 130,
			render: (_, preset) => (
				<Space size={4}>
					<Button size="small" type="link" icon={<EditOutlined />} onClick={() => setDraft(draftOf(preset))}>
						{t("编辑")}
					</Button>
					<Popconfirm
						title={t("删除预设")}
						description={t("删除后不可恢复；已用该预设创建的会话与工程任务会回退到默认 Agent")}
						okText={t("删除")}
						okButtonProps={{ danger: true }}
						cancelText={t("取消")}
						onConfirm={() => onDelete(preset.id)}
					>
						<Button size="small" type="link" danger icon={<DeleteOutlined />}>
							{t("删除")}
						</Button>
					</Popconfirm>
				</Space>
			),
		},
	];

	return (
		<>
			<Alert
				type="info"
				showIcon
				className="ui-page__alert"
				title={t(
					"预设 Agent 是「一段追加到会话系统提示的文本」，只影响身份与背景知识：它不改变可用的工具、技能或模型，也不能扩大权限——能不能做什么只由「权限」页决定。",
				)}
				description={t(
					"这个库初始为空，所有预设都由你手动创建；新建会话时可选一个，已有会话在输入框上方的「预设 Agent」里随时可换，工程模式下由指挥官按任务自行挑选。",
				)}
			/>

			{importNotice ? (
				<Alert
					type="success"
					showIcon
					closable
					className="ui-page__alert"
					title={t("导入完成：新增 {count} 个预设。", { count: importNotice.imported })}
					description={
						importNotice.skipped.length > 0 ? (
							<ul className="preset-skipped">
								{importNotice.skipped.map((item, index) => (
									<li key={`${item.name}-${index}`}>
										{item.name}：{item.reason}
									</li>
								))}
							</ul>
						) : undefined
					}
				/>
			) : null}

			<ProTable<SentinelPresetView>
				rowKey="id"
				size="middle"
				columns={columns}
				dataSource={presets}
				search={false}
				pagination={false}
				scroll={{ x: 1000 }}
				toolbar={{
					title: (
						<Text strong>
							{t("预设列表")} <Text type="secondary">{t("（{count} 条）", { count: presets.length })}</Text>
						</Text>
					),
					actions: [
						<Button key="export" icon={<DownloadOutlined />} onClick={onExport}>
							{t("导出全部")}
						</Button>,
						<Button key="import" icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
							{t("导入")}
						</Button>,
						<Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setDraft({ ...EMPTY_DRAFT })}>
							{t("新建预设")}
						</Button>,
					],
				}}
				locale={{
					emptyText: t(
						"还没有预设 Agent。点「新建预设」写入一段系统提示即可；不创建也不影响使用，会话会跑默认 Agent。",
					),
				}}
			/>

			<input
				ref={fileRef}
				type="file"
				accept=".json,application/json"
				style={{ display: "none" }}
				onChange={(event) => {
					const file = event.target.files?.[0];
					// Clear the value so picking the same file twice fires again.
					event.target.value = "";
					if (!file) return;
					void file.text().then((content) => onImport(content));
				}}
			/>

			<Modal
				title={draft?.id ? t("编辑预设") : t("新建预设")}
				open={draft !== null}
				okText={t("保存")}
				cancelText={t("取消")}
				width={720}
				okButtonProps={{ disabled: !draft?.name.trim() || !draft?.text.trim() }}
				onOk={submit}
				onCancel={() => setDraft(null)}
				destroyOnHidden
			>
				{draft ? (
					<Form layout="vertical" requiredMark={false}>
						<div className="preset-editor-grid">
							<Form.Item label={t("名称")} required>
								<Input
									value={draft.name}
									onChange={(event) => setDraft({ ...draft, name: event.target.value })}
									placeholder={t("如：内网横向 / 代码审计")}
									spellCheck={false}
								/>
							</Form.Item>
							<Form.Item label={t("一句话描述")}>
								<Input
									value={draft.description}
									onChange={(event) => setDraft({ ...draft, description: event.target.value })}
									placeholder={t("新建会话时作为提示，如：优先看 Web 漏洞")}
									spellCheck={false}
								/>
							</Form.Item>
							<Form.Item label={t("标签")}>
								<Input
									value={draft.tags}
									onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
									placeholder={t("用逗号分隔，如：web, 内网, 免杀")}
									spellCheck={false}
								/>
							</Form.Item>
							<Form.Item
								label={t("输入框提示")}
								tooltip={t("该预设生效时，输入框里的灰色提示文案；留空则用控制台默认的那句（可拖入文件 / 粘贴截图）")}
							>
								<Input
									value={draft.placeholder}
									onChange={(event) => setDraft({ ...draft, placeholder: event.target.value })}
									placeholder={t("留空用默认文案，如：说说这次要看的目标")}
									spellCheck={false}
								/>
							</Form.Item>
						</div>
						<Form.Item
							label={t("正文（追加到会话系统提示，纯文本，可任意长度）")}
							required
							extra={t("保存后显示估算 token；过大时列表会标黄/标红")}
						>
							<Input.TextArea
								value={draft.text}
								onChange={(event) => setDraft({ ...draft, text: event.target.value })}
								placeholder={t("例：你是一名内网渗透测试专家，优先使用 …")}
								autoSize={{ minRows: 8, maxRows: 20 }}
								spellCheck={false}
							/>
						</Form.Item>
					</Form>
				) : null}
			</Modal>
		</>
	);
}

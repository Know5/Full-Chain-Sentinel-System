import { CheckCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import type { ProColumns } from "@ant-design/pro-components";
import { Alert, Button, Drawer, Form, Input, InputNumber, Popconfirm, Progress, Space, Switch, Tag, Typography } from "antd";
import { useState } from "react";
import { getLanguage, t } from "../i18n.ts";
import { SettingsBar, SettingsEmpty, SettingsNote } from "../ui/Settings.tsx";
import type { SentinelTestResult, SentinelWebSearchConfigView, SentinelWebSearchKeyInput, SentinelWebSearchKeyView } from "../types.ts";

const { Link, Text } = Typography;

/**
 * The Web 搜索 (Tavily) section of the settings page.
 *
 * One row per pool key; the add form is a permanent row above the table, and a
 * save probes the key automatically, so there is no separate "先验证" step.
 * Quota renders as a meter when a usage probe has run; the stored key itself is
 * only ever shown as its last four characters.
 */

function formatWhen(at: number | null): string {
	if (at === null) return t("尚未调用");
	const diff = Date.now() - at;
	const minute = 60_000;
	if (diff < minute) return t("刚刚");
	if (diff < 60 * minute) return t("{count} 分钟前", { count: Math.round(diff / minute) });
	const date = new Date(at);
	const pad = (value: number): string => String(value).padStart(2, "0");
	if (diff < 24 * 60 * minute) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fullWhen(at: number | null): string {
	if (at === null) return t("尚未调用");
	return new Date(at).toLocaleString(getLanguage() === "zh" ? "zh-CN" : "en-US", { hour12: false });
}

export type WebSearchKeyState = "mounted" | "disabled" | "unkeyed" | "unverified";

export function webSearchKeyState(key: SentinelWebSearchKeyView): WebSearchKeyState {
	if (!key.enabled) return "disabled";
	if (!key.hasKey) return "unkeyed";
	return key.verified ? "mounted" : "unverified";
}

const STATE_LABELS: Record<WebSearchKeyState, string> = {
	mounted: t("已入池"),
	disabled: t("未启用"),
	unkeyed: t("未配置密钥"),
	unverified: t("验证失败"),
};

const STATE_COLORS: Record<WebSearchKeyState, string> = {
	mounted: "green",
	disabled: "default",
	unkeyed: "default",
	unverified: "red",
};

/**
 * Remaining/limit for the meter.
 *
 * The server's usage probe reports a plan string, and older replies may omit
 * `usage` entirely, so a plain "remaining / limit" string is parsed as a
 * fallback. No numbers means no meter: a full bar next to "0 / 1000" is worse
 * than no bar at all.
 */
function quotaUsage(key: SentinelWebSearchKeyView): { remaining: number | null; limit: number | null } | null {
	if (key.usage) return key.usage;
	const match = /^(\d+)\s*\/\s*(\d+)$/.exec((key.status.quota ?? "").trim());
	if (!match) return null;
	return { remaining: Number(match[1]), limit: Number(match[2]) };
}

/** Quota meter tone: healthy / low. */
function quotaTone(key: SentinelWebSearchKeyView): "normal" | "exception" {
	const usage = quotaUsage(key);
	if (!usage || usage.remaining === null || usage.limit === null) return "normal";
	if (usage.remaining <= 0) return "exception";
	return usage.limit > 0 && usage.remaining / usage.limit < 0.2 ? "exception" : "normal";
}

function quotaText(key: SentinelWebSearchKeyView): string {
	const usage = quotaUsage(key);
	if (!usage) return key.status.quota ?? "—";
	const left = usage.remaining === null ? "∞" : String(usage.remaining);
	return usage.limit === null ? left : `${left} / ${usage.limit}`;
}

/** null when the quota is unknown, so the row renders text without a meter. */
function quotaPercent(key: SentinelWebSearchKeyView): number | null {
	const usage = quotaUsage(key);
	if (!usage || usage.remaining === null || usage.limit === null || usage.limit <= 0) return null;
	return Math.round(Math.max(0, Math.min(1, usage.remaining / usage.limit)) * 100);
}

export function WebSearchPanel({
	config,
	busy,
	onSave,
	onDelete,
	onSaveLimit,
	onTest,
}: {
	config: SentinelWebSearchConfigView;
	busy: boolean;
	onSave: (input: SentinelWebSearchKeyInput) => void;
	onDelete: (id: string) => void;
	onSaveLimit: (limit: number) => void;
	onTest: (id?: string, key?: string) => Promise<SentinelTestResult | null>;
}) {
	const [limits, setLimits] = useState(config.sessionQueryLimit);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [labelDraft, setLabelDraft] = useState("");
	const [keyDraft, setKeyDraft] = useState("");
	const [enabledDraft, setEnabledDraft] = useState(true);
	const [testing, setTesting] = useState(false);
	/** undefined = not tested yet, null = the probe produced no result at all. */
	const [testResult, setTestResult] = useState<SentinelTestResult | null | undefined>(undefined);

	const editing = editingId ? (config.keys.find((entry) => entry.id === editingId) ?? null) : null;
	const canTest = Boolean(editing?.hasKey) || Boolean(keyDraft.trim());

	const openAdd = (): void => {
		setEditingId(null);
		setLabelDraft("");
		setKeyDraft("");
		setEnabledDraft(true);
		setTestResult(undefined);
		setDrawerOpen(true);
	};

	const openEdit = (entry: SentinelWebSearchKeyView): void => {
		setEditingId(entry.id);
		setLabelDraft(entry.label);
		setKeyDraft("");
		setEnabledDraft(entry.enabled);
		setTestResult(undefined);
		setDrawerOpen(true);
	};

	const closeDrawer = (): void => {
		setDrawerOpen(false);
		setEditingId(null);
		setTestResult(undefined);
	};

	const runDrawerTest = async (): Promise<void> => {
		if (!canTest) return;
		setTesting(true);
		setTestResult(undefined);
		try {
			const key = keyDraft.trim();
			setTestResult(await onTest(editing?.id, key ? key : undefined));
		} finally {
			setTesting(false);
		}
	};

	const saveDrawer = (): void => {
		const label = labelDraft.trim() || t("未命名 Key");
		if (editing) {
			onSave({ id: editing.id, label, key: keyDraft.trim() ? keyDraft.trim() : null, enabled: enabledDraft });
		} else {
			if (!keyDraft.trim()) return;
			onSave({ label, key: keyDraft.trim(), enabled: enabledDraft });
		}
		closeDrawer();
	};

	const deleteDrawer = (): void => {
		if (!editing) return;
		onDelete(editing.id);
		closeDrawer();
	};

	const columns: ProColumns<SentinelWebSearchKeyView>[] = [
		{
			title: "Key",
			key: "label",
			width: 280,
			render: (_, entry) => (
				<Space size={6} className="websearch-key-cell">
					<Text strong ellipsis title={entry.label}>
						{entry.label}
					</Text>
					{entry.tail ? <Text code>tvly-…{entry.tail}</Text> : null}
				</Space>
			),
		},
		{
			title: t("状态"),
			key: "state",
			width: 170,
			render: (_, entry) => {
				const state = webSearchKeyState(entry);
				return (
					<Space size={8}>
						<Tag color={STATE_COLORS[state]} variant="filled">
							{STATE_LABELS[state]}
						</Tag>
						<span className="settings-row-switch" onClick={(event) => event.stopPropagation()}>
							<Switch
								size="small"
								checked={entry.enabled}
								disabled={busy}
								title={t("启用 {label}", { label: entry.label })}
								onChange={(checked) =>
									onSave({ id: entry.id, label: entry.label, key: null, enabled: checked })
								}
							/>
						</span>
					</Space>
				);
			},
		},
		{
			title: t("剩余额度"),
			key: "quota",
			width: 180,
			render: (_, entry) => {
				const percent = quotaPercent(entry);
				return (
					<div className="websearch-quota-inline" title={entry.status.quota ?? ""}>
						{percent === null ? null : (
							<Progress
								percent={percent}
								size="small"
								status={quotaTone(entry)}
								showInfo={false}
								style={{ width: 62, margin: 0 }}
							/>
						)}
						<Text type="secondary">{quotaText(entry)}</Text>
					</div>
				);
			},
		},
		{
			title: t("最近调用"),
			key: "status",
			width: 160,
			render: (_, entry) => (
				<Text type="secondary" title={fullWhen(entry.status.at)}>
					{formatWhen(entry.status.at)}
					{entry.status.at === null ? "" : entry.status.ok ? t(" · 成功") : t(" · 失败")}
				</Text>
			),
		},
		{
			title: t("操作"),
			key: "actions",
			width: 100,
			render: (_, entry) => (
				<Button
					size="small"
					type="link"
					icon={<EditOutlined />}
					onClick={(event) => {
						event.stopPropagation();
						openEdit(entry);
					}}
				>
					{t("设置")}
				</Button>
			),
		},
	];

	return (
		<>
			<SettingsBar
				title={t("号池")}
				meta={
					<Text>
						<Text strong>{config.usable}</Text> / {config.keys.length} {t("个 Key 参与轮换")}
					</Text>
				}
				extra={
					<>
						<Text type="secondary">{t("每会话上限")}</Text>
						<InputNumber
							min={0}
							value={limits}
							onChange={(value) => setLimits(value ?? 0)}
							style={{ width: 90 }}
							aria-label={t("每个会话的搜索次数上限")}
						/>
						<Text type="secondary">{t("次 · 0 = 不限")}</Text>
						<Button type="primary" disabled={busy} onClick={() => onSaveLimit(limits)}>
							{t("保存")}
						</Button>
					</>
				}
			/>

			<ProTable<SentinelWebSearchKeyView>
				rowKey="id"
				size="small"
				columns={columns}
				dataSource={config.keys}
				search={false}
				options={false}
				pagination={false}
				tableLayout="fixed"
				scroll={{ x: 900 }}
				onRow={(entry) => ({
					onClick: () => openEdit(entry),
					style: { cursor: "pointer" },
				})}
				toolbar={{
					title: (
						<Space size={6}>
							<Text strong>{t("已加入的 Key")}</Text>
							<Text type="secondary">{t("{count} 个", { count: config.keys.length })}</Text>
						</Space>
					),
					actions: [
						<Button
							key="add"
							type="primary"
							icon={<PlusOutlined />}
							disabled={busy || config.keys.length >= 20}
							onClick={openAdd}
						>
							{t("添加 Key")}
						</Button>,
					],
				}}
				locale={{
					emptyText: (
						<SettingsEmpty
							title={t("还没有 Key")}
							hint={t("点右上角「添加 Key」，粘贴一个 Tavily Key；保存后自动验证一次。")}
						/>
					),
				}}
			/>

			<SettingsNote>
				{t(
					"保存 / 删除 Key 与修改上限都会重建会话（历史保留），有会话正在运行时会拒绝并提示，请先中止。添加 Key 时自动验证一次，通过即入池；控制台每分钟刷新一次各 Key 剩余额度，查询时优先使用剩余最多的。密钥只写入本机 websearch.json（0600），前端不回显；原始响应写入项目 evidence/search/。",
				)}
			</SettingsNote>

			<Drawer
				open={drawerOpen}
				width={460}
				onClose={closeDrawer}
				destroyOnHidden
				title={editing ? t("编辑 Key") : t("添加 Key")}
				extra={
					editing ? (
						<Tag color={STATE_COLORS[webSearchKeyState(editing)]} variant="filled">
							{STATE_LABELS[webSearchKeyState(editing)]}
						</Tag>
					) : null
				}
				footer={
					<div className="settings-drawer-foot">
						{editing ? (
							<Popconfirm
								title={t("删除这个 Key？")}
								description={t("删除后该 Key 不再参与轮换，正在运行的会话会重建。")}
								okText={t("删除")}
								okButtonProps={{ danger: true }}
								cancelText={t("取消")}
								onConfirm={deleteDrawer}
							>
								<Button danger icon={<DeleteOutlined />}>
									{t("删除")}
								</Button>
							</Popconfirm>
						) : (
							<span />
						)}
						<Space size={8} wrap>
							<Button onClick={closeDrawer}>{t("取消")}</Button>
							<Button
								icon={<CheckCircleOutlined />}
								loading={testing}
								disabled={busy || !canTest}
								onClick={() => void runDrawerTest()}
							>
								{t("测试")}
							</Button>
							<Button
								type="primary"
								disabled={busy || (!editing && !keyDraft.trim())}
								onClick={saveDrawer}
							>
								{t("保存")}
							</Button>
						</Space>
					</div>
				}
			>
				<Form layout="vertical" requiredMark={false}>
					<Form.Item label={t("备注名")}>
						<Input
							value={labelDraft}
							onChange={(event) => setLabelDraft(event.target.value)}
							placeholder={t("备注名（如 主账号）")}
							spellCheck={false}
						/>
					</Form.Item>
					<Form.Item label="API Key">
						<Input.Password
							value={keyDraft}
							onChange={(event) => {
								setKeyDraft(event.target.value);
								setTestResult(undefined);
							}}
							placeholder={editing?.hasKey ? t("已保存，留空不改") : t("粘贴 Tavily API Key（tvly-…）")}
							spellCheck={false}
							autoComplete="off"
						/>
					</Form.Item>
					<Form.Item label={t("启用")}>
						<Switch checked={enabledDraft} onChange={setEnabledDraft} disabled={busy} />
					</Form.Item>
				</Form>

				<SettingsNote>{t("保存后自动验证一次，通过即入池")}</SettingsNote>

				{testResult === null ? (
					<Alert
						type="error"
						showIcon
						className="ui-page__alert"
						title={t("无响应")}
						description={t("没有收到测试结果，请重试。")}
					/>
				) : testResult ? (
					<Alert
						type={testResult.ok ? "success" : "error"}
						showIcon
						className="ui-page__alert"
						title={testResult.ok ? t("连接可用") : t("连接失败")}
						description={
							<>
								{testResult.message}
								{testResult.detail ? <pre className="websearch-detail-pre">{testResult.detail}</pre> : null}
							</>
						}
					/>
				) : null}

				{editing?.status.error ? (
					<Alert type="error" showIcon title={t("上次错误")} description={editing.status.error} />
				) : null}

				<div className="websearch-drawer-apply">
					<Text strong>{t("申请地址")}</Text>
					<Link href="https://app.tavily.com" target="_blank" rel="noreferrer">
						https://app.tavily.com
					</Link>
				</div>
			</Drawer>
		</>
	);
}

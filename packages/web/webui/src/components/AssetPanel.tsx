import { CheckCircleOutlined, DeleteOutlined, EditOutlined, SaveOutlined } from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import type { ProColumns } from "@ant-design/pro-components";
import { Avatar, Button, Drawer, Form, Input, InputNumber, Popconfirm, Space, Switch, Tag, Typography } from "antd";
import { useState } from "react";
import { getLanguage, t } from "../i18n.ts";
import { SettingsBar, SettingsNote } from "../ui/Settings.tsx";
import { SettingsFeedback } from "../ui/SettingsFeedback.tsx";
import type {
	SentinelAssetConfigView,
	SentinelAssetPlatform,
	SentinelAssetPlatformInput,
	SentinelAssetPlatformView,
	SentinelTestResult,
} from "../types.ts";

const { Text, Link } = Typography;

/** Tool name the platform mounts, shown so the operator can match it in 权限. */
const TOOL_NAMES: Record<SentinelAssetPlatform, string> = {
	fofa: "fofa_search",
	quake: "quake_search",
	hunter: "hunter_search",
};

/** Badge letter for the platform, since the labels have no common initial. */
const PLATFORM_MARKS: Record<SentinelAssetPlatform, string> = {
	fofa: "F",
	quake: "Q",
	hunter: "H",
};

/** One platform's own query language, so the operator can copy a working example. */
const SYNTAX_EXAMPLES: Record<SentinelAssetPlatform, string> = {
	fofa: 'ip="1.1.1.1" · domain="example.com" · title="admin" · body="login"',
	quake: 'ip:"1.1.1.1" · domain:"example.com" · title:"admin" · port:8080',
	hunter: 'ip="1.1.1.1" · domain="example.com" · web.title="admin" · port="8080"',
};

/** A constraint that only bites at query time, so it sits next to the syntax. */
const SYNTAX_NOTES: Partial<Record<SentinelAssetPlatform, string>> = {
	hunter: t("Hunter 的 page_size 只接受 1 / 10 / 20 / 50 / 100，其它值由控制台向上取整。"),
};

/** Official origin, shown as the placeholder when no custom base URL is saved. */
const OFFICIAL_BASE_URLS: Record<SentinelAssetPlatform, string> = {
	fofa: "https://fofa.info",
	quake: "https://quake.360.net",
	hunter: "https://hunter.qianxin.com",
};

/** Where to apply for a key. */
const KEY_PAGES: Record<SentinelAssetPlatform, string> = {
	fofa: "https://fofa.info/userInfo/",
	quake: "https://quake.360.net/quake/#/personalInfo",
	hunter: "https://hunter.qianxin.com/home/userInfo",
};

/** Compact timestamp for the table cell; the full value rides along in the title. */
function formatWhen(at: number | null): string {
	if (at === null) return t("尚未调用");
	const date = new Date(at);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fullWhen(at: number | null): string {
	if (at === null) return t("尚未调用");
	return new Date(at).toLocaleString(getLanguage() === "zh" ? "zh-CN" : "en-US", { hour12: false });
}

/** Host shown in the table; the full endpoint rides in the title. */
function endpointLabel(platform: SentinelAssetPlatformView): string {
	const custom = platform.baseUrl.trim();
	if (!custom) {
		return `${t("官方地址")} · ${new URL(OFFICIAL_BASE_URLS[platform.id]).host}`;
	}
	try {
		return new URL(custom).host;
	} catch {
		return custom;
	}
}

/**
 * Which of the four states a platform is in. It is the single source for both
 * the row's badge and the sentence that explains the missing tool, so the badge
 * and the explanation can never disagree.
 */
export type AssetPlatformState = "mounted" | "disabled" | "unkeyed" | "unverified";

export function platformState(platform: SentinelAssetPlatformView): AssetPlatformState {
	if (!platform.enabled) return "disabled";
	if (!platform.hasKey) return "unkeyed";
	return platform.verified ? "mounted" : "unverified";
}

const STATE_LABELS: Record<AssetPlatformState, string> = {
	mounted: t("已挂载"),
	disabled: t("未启用"),
	unkeyed: t("未配置密钥"),
	unverified: t("验证失败"),
};

/** Badge tone per state. */
const STATE_COLORS: Record<AssetPlatformState, string> = {
	mounted: "green",
	disabled: "default",
	unkeyed: "default",
	unverified: "red",
};

/** Why a platform contributes no tool, phrased for the operator. */
export function mountReason(platform: SentinelAssetPlatformView): string {
	const state = platformState(platform);
	if (state === "mounted") return t("已挂载 {tool} 给 Agent", { tool: TOOL_NAMES[platform.id] });
	if (state === "disabled") return t("未启用，工具不挂载");
	if (state === "unkeyed") return t("未配置密钥，工具不挂载");
	return t("密钥未通过验证，工具不挂载");
}

/**
 * The payload for a save.
 *
 * An empty box means "keep what is stored" (the key is never read back, so the
 * operator cannot retype it by accident), and a typed value replaces it. Clearing
 * is a separate action that sends the empty string, which is the only way to
 * delete a stored key.
 */
export function platformSaveInput(
	id: SentinelAssetPlatform,
	enabled: boolean,
	draft: string | undefined,
	baseUrlDraft?: string,
): SentinelAssetPlatformInput {
	const key = draft?.trim();
	const baseUrl = baseUrlDraft?.trim();
	return {
		id,
		enabled,
		key: key ? key : null,
		// undefined keeps the stored URL; "" explicitly restores the official one.
		...(baseUrl !== undefined ? { baseUrl } : {}),
	};
}

/**
 * The 资产测绘 section of the settings page.
 *
 * One row per platform so the three can be compared at a glance — status, key,
 * quota and the last call are the columns, because "which platform is actually
 * feeding the agent" is the question this page exists to answer. The row stays a
 * single line like the rest of the workbench tables; the editable state (key,
 * BaseURL, enable switch) and the reference text (query syntax, where to apply,
 * why a tool is missing) live in the right-side drawer opened by 设置.
 *
 * The page is where a platform becomes usable: a key that is switched on and
 * verified by 测试连接 is the only thing that makes its tool appear in the
 * agent's tool list. Nothing here is read back to the browser — the stored key
 * is reported as "已保存" and never echoed.
 */
export function AssetPanel({
	config,
	busy,
	onSave,
	onSaveLimit,
	onTest,
}: {
	config: SentinelAssetConfigView;
	busy: boolean;
	onSave: (input: SentinelAssetPlatformInput) => void;
	onSaveLimit: (limit: number) => void;
	onTest: (platform: SentinelAssetPlatform, key?: string, baseUrl?: string) => Promise<SentinelTestResult | null>;
}) {
	const [limits, setLimits] = useState(config.sessionQueryLimit);
	const [editingId, setEditingId] = useState<SentinelAssetPlatform | null>(null);
	const [enabledDraft, setEnabledDraft] = useState(true);
	const [keyDraft, setKeyDraft] = useState("");
	const [baseDraft, setBaseDraft] = useState("");
	const [testing, setTesting] = useState(false);
	/** undefined = not tested yet, null = the probe produced no result at all. */
	const [testResult, setTestResult] = useState<SentinelTestResult | null | undefined>(undefined);

	const editing = editingId ? (config.platforms.find((platform) => platform.id === editingId) ?? null) : null;

	const openDrawer = (platform: SentinelAssetPlatformView): void => {
		setEditingId(platform.id);
		setEnabledDraft(platform.enabled);
		setKeyDraft("");
		setBaseDraft(platform.baseUrl);
		setTestResult(undefined);
	};

	const closeDrawer = (): void => {
		setEditingId(null);
		setKeyDraft("");
		setBaseDraft("");
		setTestResult(undefined);
	};

	const runDrawerTest = async (platform: SentinelAssetPlatformView): Promise<void> => {
		setTesting(true);
		setTestResult(undefined);
		try {
			const key = keyDraft.trim();
			setTestResult(await onTest(platform.id, key ? key : undefined, baseDraft.trim()));
		} finally {
			setTesting(false);
		}
	};

	const saveDrawer = (): void => {
		if (!editing) return;
		onSave(platformSaveInput(editing.id, enabledDraft, keyDraft, baseDraft));
		closeDrawer();
	};

	const clearDrawer = (): void => {
		if (!editing) return;
		onSave({ id: editing.id, enabled: enabledDraft, key: "", baseUrl: baseDraft });
		closeDrawer();
	};

	const columns: ProColumns<SentinelAssetPlatformView>[] = [
		{
			title: t("平台"),
			key: "platform",
			width: 260,
			render: (_, platform) => (
				<Space size={8} className="assethub-platline">
					<Avatar shape="square" size={30} className="assethub-mark">
						{PLATFORM_MARKS[platform.id]}
					</Avatar>
					<Text strong>{platform.label}</Text>
					<Text code>{TOOL_NAMES[platform.id]}</Text>
				</Space>
			),
		},
		{
			title: t("状态"),
			key: "state",
			width: 170,
			render: (_, platform) => {
				const state = platformState(platform);
				return (
					<Space size={8}>
						<Tag color={STATE_COLORS[state]} variant="filled">
							{STATE_LABELS[state]}
						</Tag>
						<span className="settings-row-switch" onClick={(event) => event.stopPropagation()}>
							<Switch
								size="small"
								checked={platform.enabled}
								disabled={busy}
								aria-label={t("启用 {label}", { label: platform.label })}
								onChange={(checked) => onSave(platformSaveInput(platform.id, checked, undefined, platform.baseUrl))}
							/>
						</span>
					</Space>
				);
			},
		},
		{
			title: t("密钥 / 端点"),
			key: "key",
			width: 300,
			render: (_, platform) => {
				const endpoint = platform.baseUrl.trim() || OFFICIAL_BASE_URLS[platform.id];
				return (
					<span className="assethub-endpoint" title={endpoint}>
						<Tag color={platform.hasKey ? "green" : "default"} variant="filled">
							{platform.hasKey ? t("已保存") : t("未配置")}
						</Tag>
						<Text type="secondary" ellipsis>
							{endpointLabel(platform)}
						</Text>
					</span>
				);
			},
		},
		{
			title: t("额度"),
			key: "quota",
			width: 100,
			ellipsis: { showTitle: true },
			render: (_, platform) => <Text type="secondary">{platform.status.quota ?? "—"}</Text>,
		},
		{
			title: t("最近调用"),
			key: "at",
			width: 140,
			render: (_, platform) => (
				<Text type="secondary" title={fullWhen(platform.status.at)}>
					{formatWhen(platform.status.at)}
					{platform.status.at === null ? "" : platform.status.ok ? t(" · 成功") : t(" · 失败")}
				</Text>
			),
		},
		{
			title: t("操作"),
			key: "actions",
			width: 100,
			render: (_, platform) => (
				<Button
					size="small"
					type="link"
					icon={<EditOutlined />}
					onClick={(event) => {
						event.stopPropagation();
						openDrawer(platform);
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
				title={t("测绘平台")}
				meta={
					<>
						<Text>
							{t("已挂载")} <Text strong>{config.usable}</Text> / {config.platforms.length} {t("个平台")}
						</Text>
						<Text type="secondary">{t("只有「已启用 + 已配置密钥 + 已验证通过」的平台才把工具挂给 Agent")}</Text>
					</>
				}
				extra={
					<>
						<Text type="secondary">{t("每会话上限")}</Text>
						<InputNumber
							min={0}
							style={{ width: 90 }}
							value={limits}
							aria-label={t("每个会话的查询次数上限")}
							onChange={(value) => setLimits(value ?? 0)}
						/>
						<Text type="secondary">{t("次 · 0 = 不限")}</Text>
						<Button type="primary" disabled={busy} onClick={() => onSaveLimit(limits)}>
							{t("保存")}
						</Button>
					</>
				}
			/>

			<ProTable<SentinelAssetPlatformView>
				rowKey="id"
				size="small"
				columns={columns}
				dataSource={config.platforms}
				search={false}
				options={false}
				pagination={false}
				tableLayout="fixed"
				scroll={{ x: 1070 }}
				onRow={(platform) => ({
					onClick: () => openDrawer(platform),
					style: { cursor: "pointer" },
				})}
			/>

			<SettingsNote>
				{t(
					"保存时会自动验证一次；每行「设置」抽屉里也可以点「测试连接」单独验证（验证结果会立即生效，并按需重建活动会话）。上限按「每个会话、三家合计」计算，子代理共用同一个额度；修改上限同样会重建会话，请先中止正在运行的会话。",
				)}{" "}
				{t("Agent 上报的资产与测试记录在侧栏「资产库」。")}
			</SettingsNote>

			{editing ? (
				<Drawer
					open
					width={520}
					onClose={closeDrawer}
					destroyOnHidden
					title={
						<Space size={8} wrap>
							<Avatar shape="square" size={28} className="assethub-mark">
								{PLATFORM_MARKS[editing.id]}
							</Avatar>
							<Text strong>{editing.label}</Text>
							<Tag color={STATE_COLORS[platformState(editing)]} variant="filled">
								{STATE_LABELS[platformState(editing)]}
							</Tag>
						</Space>
					}
					extra={<Text type="secondary">{TOOL_NAMES[editing.id]}</Text>}
					footer={
						<div className="settings-drawer-foot">
							<Popconfirm
								title={t("清除已保存的密钥")}
								description={t("清除后该平台的工具不再挂载，直到重新填写并验证。")}
								okText={t("清除")}
								okButtonProps={{ danger: true }}
								cancelText={t("取消")}
								disabled={busy || !editing.hasKey}
								onConfirm={clearDrawer}
							>
								<Button danger icon={<DeleteOutlined />} disabled={busy || !editing.hasKey}>
									{t("清除密钥")}
								</Button>
							</Popconfirm>
							<Space size={8} wrap>
								<Button onClick={closeDrawer}>{t("取消")}</Button>
								<Button
									icon={<CheckCircleOutlined />}
									loading={testing}
									disabled={busy || (!editing.hasKey && !keyDraft.trim())}
									onClick={() => void runDrawerTest(editing)}
								>
									{t("测试连接")}
								</Button>
								<Button type="primary" icon={<SaveOutlined />} disabled={busy} onClick={saveDrawer}>
									{t("保存")}
								</Button>
							</Space>
						</div>
					}
				>
					<Form layout="vertical" requiredMark={false}>
						<Form.Item label={t("启用")}>
							<Switch checked={enabledDraft} disabled={busy} onChange={setEnabledDraft} />
						</Form.Item>
						<Form.Item label="API Key" extra={editing.hasKey ? t("已保存，留空表示不修改") : t("未配置")}>
							<Input.Password
								value={keyDraft}
								onChange={(event) => {
									setKeyDraft(event.target.value);
									setTestResult(undefined);
								}}
								placeholder={editing.hasKey ? t("已保存，留空不改") : t("粘贴 API Key")}
								spellCheck={false}
								autoComplete="off"
							/>
						</Form.Item>
						<Form.Item
							label="BaseURL"
							extra={
								<>
									{t("自定义 BaseURL（留空使用官方地址）")} <Text code>{OFFICIAL_BASE_URLS[editing.id]}</Text>
								</>
							}
						>
							<Input
								value={baseDraft}
								onChange={(event) => {
									setBaseDraft(event.target.value);
									setTestResult(undefined);
								}}
								placeholder={OFFICIAL_BASE_URLS[editing.id]}
								spellCheck={false}
								autoComplete="off"
							/>
						</Form.Item>
					</Form>

					{testResult === null ? (
						<SettingsFeedback type="error" title={t("无响应")}>
							{t("没有收到测试结果，请重试。")}
						</SettingsFeedback>
					) : testResult ? (
						<SettingsFeedback
							type={testResult.ok ? "success" : "error"}
							title={testResult.ok ? t("连接可用") : t("连接失败")}
							detail={testResult.detail}
						>
							{testResult.message}
						</SettingsFeedback>
					) : editing.status.error ? (
						<SettingsFeedback type="error" title={t("上次错误")}>
							{editing.status.error}
						</SettingsFeedback>
					) : null}

					<div className="assethub-detail">
						<div>
							<Text strong>{t("挂载状态")}</Text>
							<Text type="secondary" className="assethub-detail__note">
								{t("{reason}。", { reason: mountReason(editing) })}{" "}
								{platformState(editing) === "mounted"
									? t("Agent 的工具列表里能看到 {tool}。", { tool: TOOL_NAMES[editing.id] })
									: t("条件不满足的平台不挂载工具，Agent 看不到。")}
							</Text>
						</div>
						<div>
							<Text strong>{t("查询语法（给 Agent 用）")}</Text>
							<Text code>{SYNTAX_EXAMPLES[editing.id]}</Text>
							{SYNTAX_NOTES[editing.id] ? (
								<Text type="secondary" className="assethub-detail__note">
									{SYNTAX_NOTES[editing.id]}
								</Text>
							) : null}
						</div>
						<div>
							<Text strong>{t("申请地址")}</Text>
							<Link href={KEY_PAGES[editing.id]} target="_blank" rel="noreferrer">
								{KEY_PAGES[editing.id]}
							</Link>
						</div>
						<div>
							<Text strong>{t("密钥存放")}</Text>
							<Text type="secondary" className="assethub-detail__note">
								{t(
									"只写入本机 assets.json（0600），前端不回显；查询由控制台直接发出，不进容器、不进 bash 审计，原始响应写入项目 evidence/asset/。配置自定义 BaseURL 后，密钥与查询内容会发送到该地址。",
								)}
							</Text>
						</div>
					</div>
				</Drawer>
			) : null}
		</>
	);
}

import { CheckCircleOutlined, DeleteOutlined, SaveOutlined } from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import type { ProColumns } from "@ant-design/pro-components";
import { Alert, Avatar, Button, Input, InputNumber, Popconfirm, Space, Switch, Tag, Typography } from "antd";
import { useState } from "react";
import { getLanguage, t } from "../i18n.ts";
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
 * One row per platform so the three can be compared at a glance — status, quota
 * and the last call are the columns, because "which platform is actually feeding
 * the agent" is the question this page exists to answer. Everything that is read
 * once (query syntax, where to apply, why a tool is missing) folds into the row's
 * detail, which starts open for a platform that is switched on but failing: that
 * is the state the operator has to act on.
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
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [baseDrafts, setBaseDrafts] = useState<Record<string, string>>(() =>
		Object.fromEntries(config.platforms.map((platform) => [platform.id, platform.baseUrl])),
	);
	const [limits, setLimits] = useState(config.sessionQueryLimit);
	const [testing, setTesting] = useState<string | null>(null);
	const [results, setResults] = useState<Record<string, SentinelTestResult | null>>({});

	const setDraft = (id: SentinelAssetPlatform, value: string): void => {
		setDrafts((prev) => ({ ...prev, [id]: value }));
	};

	const setBaseDraft = (id: SentinelAssetPlatform, value: string): void => {
		setBaseDrafts((prev) => ({ ...prev, [id]: value }));
	};

	const runTest = async (platform: SentinelAssetPlatformView): Promise<void> => {
		setTesting(platform.id);
		setResults((prev) => ({ ...prev, [platform.id]: null }));
		try {
			const key = drafts[platform.id]?.trim();
			const baseUrl = (baseDrafts[platform.id] ?? platform.baseUrl).trim();
			const result = await onTest(platform.id, key ? key : undefined, baseUrl);
			setResults((prev) => ({ ...prev, [platform.id]: result }));
		} finally {
			setTesting(null);
		}
	};

	const columns: ProColumns<SentinelAssetPlatformView>[] = [
		{
			title: t("平台"),
			key: "platform",
			width: 210,
			render: (_, platform) => {
				const state = platformState(platform);
				return (
					<Space size={8}>
						<Avatar shape="square" size={30} className="assethub-mark">
							{PLATFORM_MARKS[platform.id]}
						</Avatar>
						<div className="assethub-plat">
							<Text strong>{platform.label}</Text>
							<Text type="secondary">
								{TOOL_NAMES[platform.id]}
								{state === "mounted" ? "" : t(" · 未挂载")}
							</Text>
						</div>
					</Space>
				);
			},
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
						<Switch
							size="small"
							checked={platform.enabled}
							disabled={busy}
							aria-label={t("启用 {label}", { label: platform.label })}
							onChange={(checked) =>
								onSave(
									platformSaveInput(
										platform.id,
										checked,
										drafts[platform.id],
										baseDrafts[platform.id] ?? platform.baseUrl,
									),
								)
							}
						/>
					</Space>
				);
			},
		},
		{
			title: t("API Key / BaseURL"),
			key: "key",
			width: 320,
			render: (_, platform) => (
				<div className="assethub-key">
					<Input.Password
						value={drafts[platform.id] ?? ""}
						onChange={(event) => setDraft(platform.id, event.target.value)}
						placeholder={platform.hasKey ? t("已保存，留空不改") : t("粘贴 API Key")}
						spellCheck={false}
						autoComplete="off"
						aria-label={t("{label} 的 API Key", { label: platform.label })}
					/>
					<Input
						value={baseDrafts[platform.id] ?? platform.baseUrl}
						onChange={(event) => setBaseDraft(platform.id, event.target.value)}
						placeholder={`BaseURL · ${OFFICIAL_BASE_URLS[platform.id]}`}
						title={t("自定义 BaseURL（留空使用官方地址）")}
						spellCheck={false}
						autoComplete="off"
						aria-label={t("{label} 的自定义 BaseURL", { label: platform.label })}
					/>
				</div>
			),
		},
		{
			title: t("额度"),
			key: "quota",
			width: 130,
			ellipsis: { showTitle: true },
			render: (_, platform) => <Text type="secondary">{platform.status.quota ?? "—"}</Text>,
		},
		{
			title: t("最近调用"),
			key: "at",
			width: 160,
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
			width: 230,
			render: (_, platform) => (
				<Space size={4} wrap>
					<Button
						size="small"
						type="link"
						icon={<CheckCircleOutlined />}
						loading={testing === platform.id}
						disabled={!platform.hasKey && !(drafts[platform.id] ?? "").trim()}
						onClick={() => void runTest(platform)}
					>
						{t("测试")}
					</Button>
					<Button
						size="small"
						type="link"
						icon={<SaveOutlined />}
						disabled={busy}
						onClick={() =>
							onSave(
								platformSaveInput(
									platform.id,
									platform.enabled,
									drafts[platform.id],
									baseDrafts[platform.id] ?? platform.baseUrl,
								),
							)
						}
					>
						{t("保存")}
					</Button>
					<Popconfirm
						title={t("清除已保存的密钥")}
						description={t("清除后该平台的工具不再挂载，直到重新填写并验证。")}
						okText={t("清除")}
						okButtonProps={{ danger: true }}
						cancelText={t("取消")}
						disabled={busy || !platform.hasKey}
						onConfirm={() => {
							setDraft(platform.id, "");
							// The empty string is the explicit "delete the stored key".
							onSave({
								id: platform.id,
								enabled: platform.enabled,
								key: "",
								baseUrl: baseDrafts[platform.id] ?? platform.baseUrl,
							});
						}}
					>
						<Button size="small" type="link" danger icon={<DeleteOutlined />} disabled={busy || !platform.hasKey}>
							{t("清除")}
						</Button>
					</Popconfirm>
				</Space>
			),
		},
	];

	return (
		<>
			<Alert
				type="warning"
				showIcon
				className="ui-page__alert"
				title={t("外发提示")}
				description={t(
					"查询内容与 API Key 会发送到对应第三方平台（FOFA / 360 Quake / 奇安信 Hunter），查询前请确认目标在授权范围内。",
				)}
			/>
			<Text type="secondary">{t("这里配置测绘平台；Agent 上报的资产与测试记录在侧栏「资产库」。")}</Text>

			<div className="assethub-toolbar">
				<Text>
					{t("已挂载")} <Text strong>{config.usable}</Text> / {config.platforms.length}{" "}
					{t("个平台 · 只有「已启用 + 已配置密钥 + 已验证通过」的平台才把工具挂给 Agent")}
				</Text>
				<Space size={6}>
					<Text type="secondary">{t("每会话上限")}</Text>
					<InputNumber
						min={0}
						size="small"
						style={{ width: 90 }}
						value={limits}
						aria-label={t("每个会话的查询次数上限")}
						onChange={(value) => setLimits(value ?? 0)}
					/>
					<Text type="secondary">{t("次 · 0 = 不限")}</Text>
					<Button size="small" type="primary" disabled={busy} onClick={() => onSaveLimit(limits)}>
						{t("保存")}
					</Button>
				</Space>
			</div>

			<ProTable<SentinelAssetPlatformView>
				rowKey="id"
				size="middle"
				columns={columns}
				dataSource={config.platforms}
				search={false}
				options={false}
				pagination={false}
				scroll={{ x: 1180 }}
				expandable={{
					defaultExpandedRowKeys: config.platforms
						.filter((platform) => platformState(platform) === "unverified")
						.map((platform) => platform.id),
					expandedRowRender: (platform) => {
						const state = platformState(platform);
						const result = results[platform.id];
						const baseDraft = baseDrafts[platform.id] ?? platform.baseUrl;
						const note = SYNTAX_NOTES[platform.id];
						return (
							<div className="assethub-detail">
								{result ? (
									<Alert
										type={result.ok ? "success" : "error"}
										showIcon
										title={result.message}
										description={result.detail ? <pre className="assethub-detail__pre">{result.detail}</pre> : undefined}
									/>
								) : null}
								{platform.status.error ? (
									<Alert type="error" showIcon title={t("上次错误")} description={platform.status.error} />
								) : null}
								<div>
									<Text strong>{t("请求 BaseURL（保存后生效）")}</Text>
									<Text code>{baseDraft || OFFICIAL_BASE_URLS[platform.id]}</Text>
									<Text type="secondary" className="assethub-detail__note">
										{t(
											"留空即使用官方地址；也可填反向代理前缀（如 https://proxy.example/fofa），控制台会拼接各平台的 API 路径。保存后会重新验证，验证失败则工具不挂载。",
										)}
									</Text>
								</div>
								<div>
									<Text strong>{t("查询语法（给 Agent 用）")}</Text>
									<Text code>{SYNTAX_EXAMPLES[platform.id]}</Text>
									{note ? (
										<Text type="secondary" className="assethub-detail__note">
											{note}
										</Text>
									) : null}
								</div>
								<div>
									<Text strong>{t("挂载状态")}</Text>
									<Text type="secondary" className="assethub-detail__note">
										{t("{reason}。", { reason: mountReason(platform) })}{" "}
										{state === "mounted"
											? t("Agent 的工具列表里能看到 {tool}。", { tool: TOOL_NAMES[platform.id] })
											: t("条件不满足的平台不挂载工具，Agent 看不到。")}
									</Text>
								</div>
								<div>
									<Text strong>{t("申请地址")}</Text>
									<Link href={KEY_PAGES[platform.id]} target="_blank" rel="noreferrer">
										{KEY_PAGES[platform.id]}
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
						);
					},
				}}
			/>

			<Text type="secondary" className="assethub-footnote">
				{t(
					"保存时会自动验证一次，也可以点「测试」单独验证（验证结果会立即生效，并按需重建活动会话）。上限按「每个会话、三家合计」计算，子代理共用同一个额度；修改上限同样会重建会话，请先中止正在运行的会话。",
				)}
			</Text>
		</>
	);
}

import { CheckCircleOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import type { ProColumns } from "@ant-design/pro-components";
import { Alert, Button, Input, InputNumber, Progress, Space, Switch, Tag, Typography } from "antd";
import { useState } from "react";
import { getLanguage, t } from "../i18n.ts";
import type { SentinelTestResult, SentinelWebSearchConfigView, SentinelWebSearchKeyInput, SentinelWebSearchKeyView } from "../types.ts";

const { Text } = Typography;

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

/** Quota meter tone: healthy / low / spent-or-unknown. */
function quotaTone(key: SentinelWebSearchKeyView): "normal" | "exception" {
	const usage = key.usage;
	if (!usage || usage.remaining === null || usage.limit === null) return "normal";
	if (usage.remaining <= 0) return "exception";
	return usage.limit > 0 && usage.remaining / usage.limit < 0.2 ? "exception" : "normal";
}

function quotaText(key: SentinelWebSearchKeyView): string {
	const usage = key.usage;
	if (!usage) return key.status.quota ?? "—";
	const left = usage.remaining === null ? "∞" : String(usage.remaining);
	return usage.limit === null ? left : `${left} / ${usage.limit}`;
}

function quotaPercent(key: SentinelWebSearchKeyView): number {
	const usage = key.usage;
	if (!usage || usage.remaining === null || usage.limit === null || usage.limit <= 0) return 100;
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
	const [label, setLabel] = useState("");
	const [draft, setDraft] = useState("");
	const [limits, setLimits] = useState(config.sessionQueryLimit);
	const [testing, setTesting] = useState<string | null>(null);
	const [results, setResults] = useState<Record<string, SentinelTestResult | null>>({});

	const addKey = (): void => {
		if (!draft.trim() || busy) return;
		onSave({ label: label.trim() || t("未命名 Key"), key: draft.trim(), enabled: true });
		setLabel("");
		setDraft("");
	};

	const runTest = async (entry: SentinelWebSearchKeyView): Promise<void> => {
		setTesting(entry.id);
		setResults((prev) => ({ ...prev, [entry.id]: null }));
		try {
			const result = await onTest(entry.id);
			setResults((prev) => ({ ...prev, [entry.id]: result }));
		} finally {
			setTesting(null);
		}
	};

	const columns: ProColumns<SentinelWebSearchKeyView>[] = [
		{
			title: "Key",
			key: "label",
			render: (_, entry) => (
				<div className="websearch-key">
					<Text strong>{entry.label}</Text>
					<Text code>{entry.tail ? `tvly-…${entry.tail}` : "web_search / web_extract"}</Text>
				</div>
			),
		},
		{
			title: t("状态"),
			key: "state",
			width: 180,
			render: (_, entry) => {
				const state = webSearchKeyState(entry);
				return (
					<Space size={8}>
						<Tag color={STATE_COLORS[state]} variant="filled">
							{STATE_LABELS[state]}
						</Tag>
						<Switch
							size="small"
							checked={entry.enabled}
							disabled={busy}
							title={t("启用 {label}", { label: entry.label })}
							onChange={(checked) =>
								onSave({ id: entry.id, label: entry.label, key: null, enabled: checked })
							}
						/>
					</Space>
				);
			},
		},
		{
			title: t("剩余额度"),
			key: "quota",
			width: 180,
			render: (_, entry) => (
				<div className="websearch-quota">
					<Progress
						percent={quotaPercent(entry)}
						size="small"
						status={quotaTone(entry)}
						showInfo={false}
					/>
					<Text type="secondary" title={entry.status.quota ?? ""}>
						{quotaText(entry)}
					</Text>
				</div>
			),
		},
		{
			title: t("最近调用"),
			key: "status",
			width: 170,
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
			width: 200,
			render: (_, entry) => (
				<Space size={4}>
					<Button
						size="small"
						type="link"
						icon={<CheckCircleOutlined />}
						loading={testing === entry.id}
						disabled={!entry.hasKey}
						onClick={() => void runTest(entry)}
					>
						{t("测试")}
					</Button>
					<Button
						size="small"
						type="link"
						icon={<ReloadOutlined />}
						disabled={busy || (!entry.enabled && !entry.hasKey)}
						onClick={() =>
							onSave({ id: entry.id, label: entry.label, key: null, enabled: !entry.enabled })
						}
					>
						{entry.enabled ? t("禁用") : t("启用")}
					</Button>
					<Button size="small" type="link" danger icon={<DeleteOutlined />} disabled={busy} onClick={() => onDelete(entry.id)}>
						{t("删除")}
					</Button>
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
					"搜索关键词与 API Key 会发送到 Tavily（api.tavily.com），搜索前请确认不包含涉密内容。多个 Key 组成号池，控制台按剩余额度自动轮换；单 Key 额度耗尽自动切换。",
				)}
			/>

			<div className="websearch-toolbar">
				<Text>
					{t("号池")} <Text strong>{config.usable}</Text> / {config.keys.length} {t("个 Key 参与轮换")}
				</Text>
				<Space size={6} className="websearch-limit">
					<Text type="secondary">{t("每会话上限")}</Text>
					<InputNumber
						min={0}
						size="small"
						value={limits}
						onChange={(value) => setLimits(value ?? 0)}
						style={{ width: 90 }}
						aria-label={t("每个会话的搜索次数上限")}
					/>
					<Text type="secondary">{t("次 · 0 = 不限")}</Text>
					<Button size="small" type="primary" disabled={busy} onClick={() => onSaveLimit(limits)}>
						{t("保存")}
					</Button>
				</Space>
			</div>

			<div className="websearch-add">
				<Input
					value={label}
					onChange={(event) => setLabel(event.target.value)}
					placeholder={t("备注名（如 主账号）")}
					spellCheck={false}
					aria-label={t("新 Key 的备注名")}
					className="websearch-add__label"
				/>
				<Input.Password
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder={t("粘贴 Tavily API Key（tvly-…），保存后自动验证并入池")}
					spellCheck={false}
					autoComplete="off"
					aria-label={t("新 Key 的 API Key")}
					className="websearch-add__key"
					onPressEnter={addKey}
				/>
				<Button
					type="primary"
					icon={<PlusOutlined />}
					disabled={busy || !draft.trim() || config.keys.length >= 20}
					onClick={addKey}
				>
					{t("添加并验证")}
				</Button>
			</div>

			<ProTable<SentinelWebSearchKeyView>
				rowKey="id"
				size="middle"
				columns={columns}
				dataSource={config.keys}
				search={false}
				options={false}
				pagination={false}
				scroll={{ x: 900 }}
				expandable={{
					rowExpandable: (entry) => Boolean(results[entry.id] || entry.status.error),
					expandedRowRender: (entry) => (
						<div className="websearch-detail">
							{results[entry.id] ? (
								<Alert
									type={results[entry.id]?.ok ? "success" : "error"}
									showIcon
									title={results[entry.id]?.message}
									description={results[entry.id]?.detail ? <pre>{results[entry.id]?.detail}</pre> : undefined}
								/>
							) : null}
							{entry.status.error ? <Alert type="error" showIcon title={entry.status.error} /> : null}
						</div>
					),
				}}
				locale={{
					emptyText: `${t("还没有 Key：在上方粘贴并添加。申请地址")} https://app.tavily.com`,
				}}
			/>

			<Text type="secondary" className="websearch-footnote">
				{t(
					"保存 / 删除 Key 与修改上限都会重建会话（历史保留），有会话正在运行时会拒绝并提示，请先中止。添加 Key 时自动验证一次，通过即入池；控制台每分钟刷新一次各 Key 剩余额度，查询时优先使用剩余最多的。密钥只写入本机 websearch.json（0600），前端不回显；原始响应写入项目 evidence/search/。",
				)}
			</Text>
		</>
	);
}

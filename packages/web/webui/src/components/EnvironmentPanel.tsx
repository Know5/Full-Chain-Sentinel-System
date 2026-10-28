/**
 * The environment page.
 *
 * The console is a front end to a toolbox container, so this page answers the one
 * question that decides whether anything can run: is there a working Docker
 * daemon with the toolbox image behind it. It is also where the image gets built,
 * because a machine that has Docker but no image is the normal first-run state.
 *
 * Blocking items are listed first within their group and the page says plainly
 * that the chat is locked until they pass.
 */

import { CopyOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import {
	Alert,
	Button,
	Card,
	Col,
	Form,
	Input,
	Popconfirm,
	Radio,
	Row,
	Select,
	Space,
	Tag,
	Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n.ts";
import type {
	SentinelContainerNetwork,
	SentinelEnvItem,
	SentinelEnvReport,
	SentinelProxyConfigView,
	SentinelSources,
} from "../types.ts";

const { Text } = Typography;

/** One-click Chinese mirrors; the server normalizes whatever is saved. */
const CHINA_SOURCES: SentinelSources = {
	baseImage: "docker.m.daocloud.io/kalilinux/kali-rolling:latest",
	aptMirror: "http://mirrors.tuna.tsinghua.edu.cn/kali",
	pipIndex: "https://pypi.tuna.tsinghua.edu.cn/simple",
	npmRegistry: "https://registry.npmmirror.com",
	goProxy: "https://goproxy.cn,direct",
};

const EMPTY_SOURCES: SentinelSources = {
	baseImage: "",
	aptMirror: "",
	pipIndex: "",
	npmRegistry: "",
	goProxy: "",
};

const SOURCE_FIELDS: Array<{ key: keyof SentinelSources; label: string; placeholder: string }> = [
	{
		key: "baseImage",
		label: t("基础镜像"),
		placeholder: t("kalilinux/kali-rolling:latest（可只填 registry，如 docker.m.daocloud.io）"),
	},
	{ key: "aptMirror", label: t("apt 源"), placeholder: t("http://http.kali.org/kali（官方）") },
	{ key: "pipIndex", label: t("pip 源"), placeholder: t("https://pypi.org/simple（官方）") },
	{ key: "npmRegistry", label: t("npm 源"), placeholder: t("https://registry.npmjs.org（官方）") },
	{ key: "goProxy", label: t("go 代理"), placeholder: t("https://proxy.golang.org,direct（官方）") },
];

const STATUS_COLORS: Record<SentinelEnvItem["status"], string> = {
	ok: "green",
	warn: "orange",
	fail: "red",
	skipped: "default",
};

/**
 * Build sources: the base image and the package mirrors baked into the image.
 * Mounted with a key derived from the saved values, so a save or a refresh
 * re-seeds the fields without discarding edits in progress.
 */
function SourcesForm({
	initial,
	savedAt,
	busy,
	onSave,
}: {
	initial: SentinelSources;
	savedAt: number | null;
	busy: boolean;
	onSave: (sources: SentinelSources) => void;
}) {
	const [draft, setDraft] = useState<SentinelSources>(initial);
	const dirty = SOURCE_FIELDS.some((field) => draft[field.key] !== initial[field.key]);
	const set = (key: keyof SentinelSources, value: string) => setDraft((current) => ({ ...current, [key]: value }));

	return (
		<Card
			size="small"
			title={t("构建源")}
			extra={
				<Text type="secondary">
					{dirty ? t("有未保存的修改") : savedAt !== null ? t("已保存，重建镜像后生效") : null}
				</Text>
			}
		>
			<Text type="secondary" className="envhub-note">
				{t("这些值会烘焙进工具镜像，所以保存后需要重建镜像；pip / npm / go 三项在容器内运行时（pip install、npm install、go install）同样生效。留空表示使用官方源。")}
			</Text>
			<Form layout="vertical" requiredMark={false}>
				<div className="envhub-grid">
					{SOURCE_FIELDS.map((field) => (
						<Form.Item key={field.key} label={field.label}>
							<Input
								value={draft[field.key]}
								onChange={(event) => set(field.key, event.target.value)}
								placeholder={field.placeholder}
								spellCheck={false}
							/>
						</Form.Item>
					))}
				</div>
				<Space size={8} wrap className="envhub-actions">
					<Button size="small" disabled={busy} onClick={() => setDraft(CHINA_SOURCES)}>
						{t("中国镜像源")}
					</Button>
					<Button size="small" disabled={busy} onClick={() => setDraft(EMPTY_SOURCES)}>
						{t("清空（用官方源）")}
					</Button>
					<Button size="small" type="primary" disabled={busy || !dirty} onClick={() => onSave(draft)}>
						{t("保存")}
					</Button>
				</Space>
			</Form>
		</Card>
	);
}

/**
 * Container network: whether a project container shares the host's network stack
 * or keeps Docker's own. Host is the default because it is what makes a listener
 * inside the container reachable from the target, and because a real LAN, VPN and
 * internal DNS are what the tools need to see.
 */
const NETWORK_OPTIONS: Array<{ value: SentinelContainerNetwork; label: string; detail: string }> = [
	{
		value: "host",
		label: t("host（默认）"),
		detail:
			t("容器直接用宿主机的网络：里面起的监听端口（反向 shell、payload 服务、handler）目标机器能连回来，127.0.0.1 就是宿主机（Burp、本地靶场），内网、VPN 与内网 DNS 都是真实的。代价是与宿主机抢端口，且不再有 Docker 的网络隔离。"),
	},
	{
		value: "bridge",
		label: t("bridge（Docker 默认隔离）"),
		detail:
			t("容器有自己的地址，只能通过 host.docker.internal 访问宿主机，且不对外发布任何端口——目标机器连不回容器里的监听。需要隔离、也不需要反弹时用它。"),
	},
];

/**
 * Container network and proxy defaults, in one card.
 *
 * They are one decision: a project container either uses the host/bridge network
 * or a sidecar, and which sidecar it gets — and which image that sidecar runs —
 * is the other half of the same question. Two cards meant two saves and two
 * places to look when a container came up on the wrong network.
 *
 * The proxy fields are part of the same draft, so one 保存 commits the lot; the
 * pull button stays separate because it is an action, not a setting.
 */
function NetworkAndProxyForm({
	initial,
	savedAt,
	config,
	busy,
	pulling,
	onSave,
	onPull,
}: {
	initial: SentinelContainerNetwork;
	savedAt: number | null;
	config: SentinelProxyConfigView;
	busy: boolean;
	pulling: boolean;
	onSave: (network: SentinelContainerNetwork, defaultId: string | null, image: string) => void;
	onPull: () => void;
}) {
	const [network, setNetwork] = useState<SentinelContainerNetwork>(initial);
	const [defaultId, setDefaultId] = useState<string | null>(config?.defaultId ?? null);
	const [image, setImage] = useState(config?.image ?? "");
	const list = Array.isArray(config?.proxies) ? config.proxies : [];
	const dirty = network !== initial || defaultId !== (config?.defaultId ?? null) || image !== (config?.image ?? "");

	return (
		<Card
			size="small"
			title={t("容器网络与代理")}
			extra={
				<Space size={8}>
					<Tag color={config?.imagePresent ? "green" : "orange"} variant="filled">
						{config?.imagePresent ? t("镜像已在本地") : t("镜像不在本地")}
					</Tag>
					<Text type="secondary">
						{dirty ? t("有未保存的修改") : savedAt !== null ? t("已保存，重建容器后生效") : null}
					</Text>
				</Space>
			}
		>
			<Text type="secondary" className="envhub-note">
				{t("新建项目和重建的容器用这里的设置；已经在跑的容器保持原样，要到「项目」页点「重建容器」才会切换（下面「项目容器」那一项会写明它们现在用的是哪个）。")}
			</Text>

			<Radio.Group
				className="envhub-network"
				value={network}
				disabled={busy}
				onChange={(event) => setNetwork(event.target.value as SentinelContainerNetwork)}
			>
				<Space orientation="vertical" size={8} style={{ width: "100%" }}>
					{NETWORK_OPTIONS.map((option) => (
						<Radio key={option.value} value={option.value} className="envhub-network__option">
							<Text strong>{option.label}</Text>
							<Text type="secondary" className="envhub-network__detail">
								{option.detail}
							</Text>
						</Radio>
					))}
				</Space>
			</Radio.Group>

			<Text type="secondary" className="envhub-note">
				{t("没有单独选过代理的项目跟这里选的走；新建项目时也可以单独指定。选「不使用」时容器直接用宿主机的网络。")}
			</Text>

			<Row gutter={[12, 12]} align="bottom">
				<Col xs={24} md={10}>
					<Text type="secondary">{t("默认代理")}</Text>
					<Select
						style={{ width: "100%" }}
						value={defaultId ?? ""}
						onChange={(value) => setDefaultId(value || null)}
						options={[
							{ value: "", label: t("不使用（新项目默认直连）") },
							...list.map((proxy) => ({ value: proxy.id, label: proxy.name })),
						]}
					/>
				</Col>
				<Col xs={24} md={10}>
					<Text type="secondary">{t("sidecar 镜像")}</Text>
					<Input value={image} spellCheck={false} onChange={(event) => setImage(event.target.value)} />
				</Col>
				<Col xs={24} md={4}>
					<Button block loading={pulling} disabled={busy || pulling} onClick={onPull}>
						{pulling ? t("拉取中…") : t("拉取镜像")}
					</Button>
				</Col>
			</Row>
			<Text type="secondary" className="envhub-note">
				{t("镜像名国内拉不动 ghcr.io 时换成可达的镜像源；改完要重新拉取一次。")}
			</Text>

			<div className="envhub-actions">
				<Button type="primary" onClick={() => onSave(network, defaultId, image)} disabled={busy || !dirty}>
					{t("保存")}
				</Button>
			</div>
		</Card>
	);
}

const STATUS_LABEL: Record<SentinelEnvItem["status"], string> = {
	ok: t("通过"),
	warn: t("警告"),
	fail: t("失败"),
	skipped: t("跳过"),
};

/** Stable group order, independent of the order the server emitted items in. */
const GROUP_ORDER = ["Docker 运行时", "工具镜像", "容器能力", "宿主环境"];

function grouped(items: SentinelEnvItem[]): { group: string; items: SentinelEnvItem[] }[] {
	const names = [...new Set([...GROUP_ORDER, ...items.map((item) => item.group)])];
	return names
		.map((group) => ({ group, items: items.filter((item) => item.group === group) }))
		.filter((entry) => entry.items.length > 0);
}

function diagnostics(report: SentinelEnvReport): string {
	const lines = [
		t("全链哨兵 环境诊断"),
		t("时间: {time}", { time: new Date(report.at).toLocaleString("zh-CN") }),
		t("地址: {url}", { url: report.url }),
		t("结论: {result}", { result: report.ok ? t("通过") : t("未通过") }),
		"",
	];
	for (const { group, items } of grouped(report.items)) {
		lines.push(`[${t(group)}]`);
		for (const item of items) {
			lines.push(`${STATUS_LABEL[item.status]}${item.blocking ? t("(阻断)") : ""} ${item.label}: ${item.detail}`);
			if (item.hint) lines.push(`  ${t("建议: {hint}", { hint: item.hint })}`);
		}
	}
	return lines.join("\n");
}

export function EnvironmentPanel({
	report,
	building,
	buildLog,
	onRefresh,
	onBuild,
	onAbortBuild,
	onSaveSources,
	sourcesSavedAt,
	networkSavedAt,
	proxyConfig,
	pullingImage,
	onSaveNetworkAndProxy,
	onPullProxyImage,
}: {
	report: SentinelEnvReport | null;
	building: boolean;
	buildLog: string[];
	onRefresh: () => void;
	onBuild: () => void;
	onAbortBuild: () => void;
	onSaveSources: (sources: SentinelSources) => void;
	sourcesSavedAt: number | null;
	/** When the network/proxy settings were last saved, for the "saved" note. */
	networkSavedAt: number | null;
	/** Profiles and the sidecar image, which the same card edits. */
	proxyConfig: SentinelProxyConfigView;
	pullingImage: boolean;
	onSaveNetworkAndProxy: (network: SentinelContainerNetwork, defaultId: string | null, image: string) => void;
	onPullProxyImage: () => void;
}) {
	const [copyNote, setCopyNote] = useState<string | null>(null);
	const [fallback, setFallback] = useState<string | null>(null);
	const logRef = useRef<HTMLPreElement | null>(null);

	// Keep the newest build output in view; the build streams for minutes.
	useEffect(() => {
		const node = logRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [buildLog]);

	const copyDiagnostics = async () => {
		if (!report) return;
		const text = diagnostics(report);
		try {
			await navigator.clipboard.writeText(text);
			setFallback(null);
			setCopyNote(t("已复制"));
		} catch {
			// Clipboard access needs a secure context; a LAN address over http is not one.
			setFallback(text);
			setCopyNote(t("复制失败，请手动选择下面的文本"));
		}
		window.setTimeout(() => setCopyNote(null), 4000);
	};

	if (!report) {
		return <Text type="secondary">{t("正在检查 Docker 环境…")}</Text>;
	}

	const failures = report.items.filter((entry) => entry.blocking && entry.status !== "ok");
	const warnings = report.items.filter((entry) => entry.status === "warn");

	return (
		<>
			<div className="envhub-head">
				<Tag color={report.ok ? "green" : "red"} variant="filled" className="envhub-verdict">
					{report.ok ? t("环境可用") : t("环境不可用")}
				</Tag>
				<Text type="secondary">
					{t("检查于")} {new Date(report.at).toLocaleString("zh-CN")} · {report.url}
				</Text>
				<Space size={8} className="envhub-head__actions">
					{copyNote ? <Text type="secondary">{copyNote}</Text> : null}
					<Button size="small" icon={<CopyOutlined />} onClick={() => void copyDiagnostics()} title={t("复制全部检查项，便于排障")}>
						{t("复制诊断")}
					</Button>
					<Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} disabled={building} title={t("重新检查")}>
						{t("复检")}
					</Button>
					{building ? (
						<Button size="small" danger icon={<StopOutlined />} onClick={onAbortBuild}>
							{t("中止构建")}
						</Button>
					) : (
						<Popconfirm
							title={t("构建工具镜像")}
							description={t("用内置的 Dockerfile 构建 sentinel:latest，首次约 5–15 分钟。")}
							okText={t("确认构建")}
							cancelText={t("取消")}
							onConfirm={onBuild}
						>
							<Button size="small" type="primary" icon={<PlayCircleOutlined />} title={t("用内置的 Dockerfile 构建 sentinel:latest")}>
								{t("构建镜像")}
							</Button>
						</Popconfirm>
					)}
				</Space>
			</div>

			{report.ok ? (
				<Alert
					type="success"
					showIcon
					className="ui-page__alert"
					title={t("Docker 环境正常，工具调用会在项目容器内执行。镜像更新、切换机器或修改 Dockerfile 后回来复检即可。")}
				/>
			) : (
				<Alert
					type="error"
					showIcon
					className="ui-page__alert"
					title={t("对话已锁定：{count} 项阻断检查未通过，Agent 无法执行任何工具。", { count: failures.length })}
					description={
						failures.some((entry) => entry.id === "image-present")
							? t("镜像不存在时点右上角「构建镜像」，首次构建约 5–15 分钟并需要网络。")
							: undefined
					}
				/>
			)}

			<SourcesForm
				key={JSON.stringify(report.sources)}
				initial={report.sources}
				savedAt={sourcesSavedAt}
				busy={building}
				onSave={onSaveSources}
			/>

			<NetworkAndProxyForm
				key={`${report.containerNetwork}|${proxyConfig?.defaultId ?? ""}|${proxyConfig?.image ?? ""}`}
				initial={report.containerNetwork}
				savedAt={networkSavedAt}
				config={proxyConfig}
				busy={building}
				pulling={pullingImage}
				onSave={onSaveNetworkAndProxy}
				onPull={onPullProxyImage}
			/>

			{building || buildLog.length > 0 ? (
				<Card size="small" title={building ? t("正在构建工具镜像…") : t("上次构建输出")}>
					<pre className="envhub-buildlog" ref={logRef}>
						{buildLog.length > 0 ? buildLog.join("\n") : t("等待 docker build 输出…")}
					</pre>
				</Card>
			) : null}

			{grouped(report.items).map(({ group, items }) => (
				<Card key={group} size="small" title={t(group)}>
					<div className="envhub-list">
						{items.map((item) => (
							<div key={item.id} className={`envhub-row status-${item.status}`}>
								<Tag color={STATUS_COLORS[item.status]} variant="filled" className="envhub-row__status">
									{STATUS_LABEL[item.status]}
								</Tag>
								<div className="envhub-row__body">
									<Space size={6} wrap>
										<Text strong>{item.label}</Text>
										{item.blocking ? (
											<Tag color="red" variant="filled">
												{t("阻断")}
											</Tag>
										) : null}
									</Space>
									<Text type="secondary">{item.detail}</Text>
									{item.hint ? <Text type="warning">{item.hint}</Text> : null}
								</div>
							</div>
						))}
					</div>
				</Card>
			))}

			{warnings.length > 0 ? (
				<Text type="secondary">{t("警告项不影响运行，但可能让工具变慢或缺少能力，建议一并处理。")}</Text>
			) : null}

			{fallback ? (
				<Card size="small" title={t("诊断信息（手动复制）：")}>
					<Input.TextArea className="envhub-diag" readOnly value={fallback} rows={12} />
				</Card>
			) : null}
		</>
	);
}

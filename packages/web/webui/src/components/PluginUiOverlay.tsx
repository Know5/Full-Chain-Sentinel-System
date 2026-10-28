import { Button, Card, Modal, Result, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SentinelPluginView } from "../types.ts";
import { t } from "../i18n.ts";

const { Text } = Typography;

/** Everything the iframe may know at handshake time. Keep it non-secret. */
export interface PluginUiContext {
	plugin: { id: string; name: string; version: string; author: string };
	host: { id: string; name: string };
	/** Active project name, or null when the console has no project selected. */
	project: string | null;
	tools: Array<{ name: string; description: string }>;
	/** Config keys that already have a value; secrets only appear here as keys. */
	configKeys: string[];
}

export interface PluginUiCallResult {
	ok: boolean;
	result?: unknown;
	error?: string;
}

/**
 * The plugin's own frontend in a sandboxed iframe.
 *
 * `sandbox="allow-scripts"` without `allow-same-origin` is the whole security
 * model: the document gets an opaque origin, so it cannot read the console's
 * cookies, DOM, or storage, cannot submit a form to the console, and cannot
 * navigate the top window. Data comes only from the postMessage bridge, and the
 * bridge is checked against a nonce generated for this open.
 */
export function PluginUiOverlay({
	plugin,
	nonce,
	token,
	context,
	onCall,
	onClose,
	variant = "overlay",
}: {
	plugin: SentinelPluginView;
	nonce: string;
	/** Capability token from the console; authenticated the static assets. */
	token: string;
	context: PluginUiContext;
	onCall: (method: string, params: unknown) => Promise<PluginUiCallResult>;
	onClose: () => void;
	/** `page` embeds the same surface in the content area instead of a full-screen layer. */
	variant?: "overlay" | "page";
}) {
	const frame = useRef<HTMLIFrameElement | null>(null);
	const callRef = useRef(onCall);
	callRef.current = onCall;
	const readyRef = useRef(false);
	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState("");
	const [attempt, setAttempt] = useState(0);

	const ui = plugin.manifest.ui;
	const src = useMemo(() => {
		const entry = ui?.entry ?? "/ui/index.html";
		// Keep the whole path below /ui/: a plugin may ship sub/panel.html and
		// expect ./app.js to resolve next to it.
		const relative = entry.replace(/^\/+/, "").replace(/^ui\//, "");
		const path = (relative || "index.html").split("/").map(encodeURIComponent).join("/");
		return `/plugin-ui/${encodeURIComponent(token)}/${encodeURIComponent(plugin.hostId)}/${encodeURIComponent(plugin.manifest.id)}/${path}#nonce=${encodeURIComponent(nonce)}`;
	}, [plugin.hostId, plugin.manifest.id, ui?.entry, nonce, token]);

	useEffect(() => {
		readyRef.current = false;
		setStatus("loading");
		setError("");
		const timer = window.setTimeout(() => {
			if (readyRef.current) return;
			setStatus("error");
			setError(t("界面在 12 秒内没有连上控制台。常见原因：入口页没有引入 sdk.js、脚本报错，或入口文件路径不对。"));
		}, 12000);
		return () => window.clearTimeout(timer);
	}, [attempt, src]);

	const retry = (): void => {
		setAttempt((value) => value + 1);
	};

	useEffect(() => {
		const onMessage = (event: MessageEvent): void => {
			const target = frame.current?.contentWindow;
			if (!target || event.source !== target) return;
			const data = event.data as
				| {
						kind?: unknown;
						protocol?: unknown;
						nonce?: unknown;
						id?: unknown;
						method?: unknown;
						params?: unknown;
				  }
				| null;
			if (!data || typeof data !== "object") return;

			if (data.kind === "sentinel-ui:hello") {
				// The origin is opaque ("null") by design, so the nonce, the protocol,
				// and the source window are the identity check.
				if (data.protocol !== 1 || data.nonce !== nonce) return;
				readyRef.current = true;
				setStatus("ready");
				setError("");
				target.postMessage({ kind: "sentinel-ui:init", protocol: 1, context }, "*");
				return;
			}

			if (data.kind === "sentinel-ui:call") {
				const id = data.id;
				const method = typeof data.method === "string" ? data.method : "";
				if (!id || !method) return;
				void callRef
					.current(method, data.params)
					.then((answer) => {
						target.postMessage({ kind: "sentinel-ui:result", id, ...answer }, "*");
					})
					.catch((error: unknown) => {
						target.postMessage(
							{
								kind: "sentinel-ui:result",
								id,
								ok: false,
								error: error instanceof Error ? error.message : String(error),
							},
							"*",
						);
					});
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [context, nonce]);

	const header = (
		<Space size={10} wrap>
			<Text strong>{plugin.manifest.name}</Text>
			<Text type="secondary">v{plugin.manifest.version}</Text>
			<Text type="secondary">
				{plugin.manifest.id} · {plugin.hostName}
				{plugin.hostLocal ? t("（本机）") : ""} · {t("第三方插件界面，不要在这里输入控制台密码")}
			</Text>
		</Space>
	);
	const actions = (
		<Space size={8}>
			<Tag color={status === "ready" ? "green" : status === "error" ? "red" : "processing"} variant="filled">
				{status === "ready" ? t("已连接") : status === "error" ? t("未连接") : t("连接中")}
			</Tag>
			<Button size="small" onClick={retry} title={t("重新加载界面")}>
				{t("重载")}
			</Button>
			{variant === "overlay" ? (
				<Button size="small" onClick={onClose}>
					{t("关闭")}
				</Button>
			) : null}
		</Space>
	);
	const body = (
		<div className="plugui-body">
			<iframe
				key={attempt}
				ref={frame}
				className={status === "ready" ? "plugui-frame" : "plugui-frame is-hidden"}
				title={t("{name} 界面", { name: plugin.manifest.name })}
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				src={src}
			/>
			{status === "loading" ? (
				<div className="plugui-state">
					<Spin />
					<Text strong>{t("正在加载插件界面")}</Text>
					<Text type="secondary">{t("首次打开会向插件主机取静态资源。")}</Text>
				</div>
			) : null}
			{status === "error" ? (
				<Result
					status="warning"
					title={t("插件界面没有响应")}
					subTitle={error}
					extra={
						<Space size={8}>
							<Button type="primary" onClick={retry}>
								{t("重试")}
							</Button>
							<Button onClick={onClose}>{t("关闭")}</Button>
						</Space>
					}
				>
					<Text code>{ui?.entry ?? "/ui/index.html"}</Text>
				</Result>
			) : null}
		</div>
	);

	if (variant === "page") {
		return (
			<Card size="small" className="plugui" title={header} extra={actions}>
				{body}
			</Card>
		);
	}
	return (
		<Modal
			open
			width="92vw"
			footer={null}
			onCancel={onClose}
			destroyOnHidden
			className="plugui"
			title={header}
			styles={{ body: { height: "74vh", padding: 0, overflow: "hidden" } }}
		>
			{body}
		</Modal>
	);
}

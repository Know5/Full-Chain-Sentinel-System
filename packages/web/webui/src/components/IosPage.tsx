/**
 * The iOS device page.
 *
 * Same shape as the Android page: the left column owns the reverse listener
 * (bind address/port, applied at runtime) and the token list, the right column
 * owns the devices and the deployment steps. A device with no listener bound
 * dials the console origin; binding 0.0.0.0 gives the phone a LAN address even
 * when the console itself stays on loopback. The toolset switch stays in the
 * conversation, not here.
 */

import { CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Badge, Button, Card, Col, Input, Modal, Row, Select, Space, Steps, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { t } from "../i18n.ts";
import type { IosDevice, IosToken, SentinelClientMessage } from "../types.ts";
import { Page } from "../ui/Page.tsx";

const { Text } = Typography;

const SILEO_REPO = "https://zgsfsec.github.io/sentinel-ios-repo/";

function formatTime(iso: string | null): string {
	if (!iso) return "—";
	return iso.slice(0, 19).replace("T", " ");
}

export function IosPage({
	connected,
	devices,
	tokens,
	listen,
	listenConfig,
	lanIps,
	certPin,
	consoleUrl,
	send,
}: {
	connected: boolean;
	devices: IosDevice[];
	tokens: IosToken[];
	listen: { host: string; port: number } | null;
	listenConfig: { host: string; port: number } | null;
	lanIps: string[];
	/** SHA-256 of the console leaf certificate, offered for wss pinning. */
	certPin: string | null;
	consoleUrl: string;
	send(message: SentinelClientMessage): void;
}) {
	const [label, setLabel] = useState("");
	const [revealed, setRevealed] = useState<string | null>(null);
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
	const [listenHost, setListenHost] = useState("0.0.0.0");
	const [listenPort, setListenPort] = useState("9945");
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (listenConfig) {
			setListenHost(listenConfig.host);
			setListenPort(String(listenConfig.port));
		}
	}, [listenConfig]);

	useEffect(() => {
		if (connected) send({ type: "ios_state" });
	}, [connected, send]);

	// The address the phone should dial: the dedicated listener when bound, the
	// console origin otherwise. 0.0.0.0 is a bind address, not dialable — show the
	// machine's first LAN IPv4 and say so.
	const reverseAddress = (() => {
		if (listen) {
			const host = listen.host === "0.0.0.0" ? (lanIps[0] ?? "0.0.0.0") : listen.host;
			const note = listen.host === "0.0.0.0" && lanIps.length > 1 ? t("（多网卡，如不通请手改 IP）") : "";
			return { url: `wss://${host}:${listen.port}/ws/ios`, note };
		}
		return {
			url: `${consoleUrl.replace(/^https:/, "wss:").replace(/^http:/, "wss:").replace(/\/$/, "")}/ws/ios`,
			note: t("（未启用独立监听，随控制台地址）"),
		};
	})();
	const reverseUrl = reverseAddress.url;
	const onlineCount = devices.filter((device) => device.online && !device.stale).length;
	const staleCount = devices.filter((device) => device.stale).length;

	const installCommand = `packages/web/ios/scripts/install-ios.sh root@<设备IP> --url '${reverseUrl}' --token '${tokens[0]?.token ?? "<token>"}' --pin '${certPin ?? "<fingerprint>"}'`;

	const saveRename = () => {
		if (!renaming) return;
		const name = renaming.name.trim();
		if (name) send({ type: "ios_device_rename", id: renaming.id, name });
		setRenaming(null);
	};

	const copyCommand = () => {
		void navigator.clipboard?.writeText(installCommand).then(
			() => {
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1500);
			},
			() => undefined,
		);
	};

	return (
		<Page
			title={t("iOS 设备")}
			description={
				devices.length > 0
					? t("{online}/{total} 台在线", { online: onlineCount, total: devices.length })
					: t("SentinelBridge 反连通道与设备管理")
			}
			extra={
				<Button icon={<ReloadOutlined />} onClick={() => send({ type: "ios_state" })}>
					{t("刷新")}
				</Button>
			}
		>
			<Row gutter={[16, 16]} className="droidhub-layout">
				<Col xs={24} xl={12}>
					<Space orientation="vertical" size={16} className="droidhub-col">
						<Card
							size="small"
							title={
								<Space size={8}>
									{t("反连服务")}
									{listen ? (
										<Tag color="success" variant="filled">
											{t("监听中 {host}:{port}", { host: listen.host, port: listen.port })}
										</Tag>
									) : (
										<Tag variant="filled">{t("未启用独立监听")}</Tag>
									)}
								</Space>
							}
						>
							<div className="droidhub-field">
								<Text type="secondary">{t("监听地址")}</Text>
								<Select
									value={listenHost}
									onChange={setListenHost}
									options={[
										{ value: "0.0.0.0", label: `0.0.0.0${t("（所有网卡，局域网手机可连）")}` },
										{ value: "127.0.0.1", label: `127.0.0.1${t("（仅本机）")}` },
										...lanIps.map((ip) => ({ value: ip, label: `${ip}${t("（网卡）")}` })),
									]}
								/>
							</div>
							<div className="droidhub-field">
								<Text type="secondary">{t("端口")}</Text>
								<Input
									value={listenPort}
									onChange={(event) => setListenPort(event.target.value.replace(/\D/g, ""))}
									placeholder="9945"
								/>
							</div>
							<Button
								type="primary"
								block
								disabled={!listenHost || !listenPort}
								onClick={() => send({ type: "ios_set_listen", host: listenHost, port: Number(listenPort) })}
							>
								{t("应用并重绑")}
							</Button>
							<Text type="secondary" className="droidhub-hint">
								{t("独立于控制台端口，应用立即生效；0.0.0.0 表示局域网内手机都可反连（仍需 token）。")}
							</Text>

							<div className="droidhub-url">
								<Text code copyable>
									{reverseUrl}
								</Text>
								{reverseAddress.note ? <Text type="secondary">{reverseAddress.note}</Text> : null}
							</div>
							<Text type="secondary" className="droidhub-hint">
								{t("iOS 端主动连控制台，不需要在手机上开放端口；局域网内填这台机器的地址，跨网段用域名或内网穿透。")}
							</Text>
							<Text type="secondary" className="droidhub-hint">
								{t("iOS 强制 wss；独立监听也使用控制台 TLS。把下面的 wss 地址和证书指纹填进设备 setup 页。")}
							</Text>

							{certPin ? (
								<div className="droidhub-field">
									<Text type="secondary">{t("控制台证书 SHA-256（wss 自签时填进设备）")}</Text>
									<Text code className="droidhub-pin">
										{certPin}
									</Text>
									<Button
										size="small"
										icon={<CopyOutlined />}
										onClick={() => void navigator.clipboard?.writeText(certPin).catch(() => undefined)}
									>
										{t("复制")}
									</Button>
								</div>
							) : null}
						</Card>

						<Card
							size="small"
							title={
								<Space size={8}>
									{t("连接令牌")}
									<Tag variant="filled">{t("{count} 个", { count: tokens.length })}</Tag>
								</Space>
							}
						>
							<div className="droidhub-inline">
								<Input
									value={label}
									placeholder={t("名称，例如 测试机-iPhone 12")}
									onChange={(event) => setLabel(event.target.value)}
									onPressEnter={() => {
										if (!label.trim()) return;
										send({ type: "ios_token_create", label: label.trim() });
										setLabel("");
									}}
								/>
								<Button
									type="primary"
									onClick={() => {
										if (!label.trim()) return;
										send({ type: "ios_token_create", label: label.trim() });
										setLabel("");
									}}
								>
									{t("创建")}
								</Button>
							</div>

							{tokens.length === 0 ? (
								<Text type="secondary" className="droidhub-hint">
									{t("还没有 token。创建一个，然后复制到 iPhone setup 页。")}
								</Text>
							) : (
								<div className="droidhub-tokens">
									{tokens.map((token) => (
										<div key={token.id} className="droidhub-token">
											<div className="droidhub-token__main">
												<Text strong>{token.label}</Text>
												<Text code className="droidhub-token__value">
													{revealed === token.id ? token.token : `${token.token.slice(0, 16)}…`}
												</Text>
												<Text type="secondary" className="droidhub-token__meta">
													{t("创建 {created} · 最近使用 {used}", {
														created: formatTime(token.createdAt),
														used: formatTime(token.lastUsedAt),
													})}
												</Text>
											</div>
											<Space size={4} wrap>
												<Button
													size="small"
													onClick={() => {
														const show = revealed !== token.id;
														setRevealed((prev) => (prev === token.id ? null : token.id));
														if (show) void navigator.clipboard?.writeText(token.token).catch(() => undefined);
													}}
												>
													{revealed === token.id ? t("隐藏") : t("显示/复制")}
												</Button>
												<Button
													size="small"
													danger
													onClick={() => send({ type: "ios_token_delete", id: token.id })}
												>
													{t("删除")}
												</Button>
											</Space>
										</div>
									))}
								</div>
							)}
						</Card>
					</Space>
				</Col>

				<Col xs={24} xl={12}>
					<Space orientation="vertical" size={16} className="droidhub-col">
						<Card
							size="small"
							title={
								<Space size={8}>
									{t("设备")}
									<Tag variant="filled">
										{t("{online} 在线 / {total} 台", { online: onlineCount, total: devices.length })}
									</Tag>
								</Space>
							}
						>
							{staleCount > 0 ? (
								<Alert
									type="warning"
									showIcon
									className="ui-page__alert"
									title={t(
										"{count} 台设备 socket 还在但已停止响应：进程可能被 iOS 挂起，请在设备上重开 SentinelBridge。",
										{ count: staleCount },
									)}
								/>
							) : null}
							{devices.length === 0 ? (
								<Text type="secondary" className="droidhub-hint">
									{t("还没有设备注册过。按下方指引安装 SentinelBridge 并反连。")}
								</Text>
							) : (
								<div className="droidhub-devices">
									{devices.map((device) => (
										<div
											key={device.id}
											className={device.online && !device.stale ? "droidhub-device" : "droidhub-device is-offline"}
										>
											<div className="droidhub-device__head">
												<Badge status={device.online && !device.stale ? "success" : "default"} />
												<Text strong>{device.name}</Text>
												<Text type="secondary">{device.model}</Text>
											</div>
											<Space size={4} wrap className="droidhub-device__facts">
												<Tag variant="filled">
													iOS {device.osVersion}
													{device.build ? ` (${device.build})` : ""}
												</Tag>
												<Tag variant="filled">{device.arch}</Tag>
												<Tag variant="filled">
													{device.jailbreakName || t("未知越狱")} {device.jailbreakVersion} · {device.jailbreakForm}
												</Tag>
												<Tag color={device.hasRoot ? "green" : "default"} variant="filled">
													{device.hasRoot ? t("daemon 有 root") : t("仅 App 权限")}
												</Tag>
												<Tag variant="filled">
													{device.stale
														? t("无响应 {seconds}s", { seconds: Math.round((device.idleMs ?? 0) / 1000) })
														: device.online
															? t("在线")
															: t("离线 · {time}", { time: formatTime(device.lastSeen) })}
												</Tag>
												<Tag variant="filled">id {device.id.slice(0, 8)}</Tag>
											</Space>
											<Space size={4} className="droidhub-device__ops">
												<Button size="small" onClick={() => setRenaming({ id: device.id, name: device.name })}>
													{t("重命名")}
												</Button>
												<Button size="small" danger onClick={() => send({ type: "ios_device_remove", id: device.id })}>
													{t("移除")}
												</Button>
											</Space>
										</div>
									))}
								</div>
							)}
						</Card>

						<Card size="small" title={t("Sileo 安装")}>
							<Text type="secondary" className="droidhub-hint">
								{t("在 Sileo 添加源，安装 SentinelBridge；rootless/rootful 由设备架构自动选择。")}
							</Text>
							<div className="droidhub-url">
								<Text code copyable>
									{SILEO_REPO}
								</Text>
							</div>
							<Text type="secondary" className="droidhub-hint">
								{t("装完在 iPhone Safari 打开 http://127.0.0.1:9945/setup，填入控制台 wss 地址和左侧 token。")}
							</Text>
							<Text type="secondary" className="droidhub-hint">
								{t("没有 Sileo 源时用 SSH 回退：")}
							</Text>
							<pre className="droidhub-command">{installCommand}</pre>
							<Button size="small" icon={<CopyOutlined />} onClick={copyCommand}>
								{copied ? t("已复制") : t("复制命令")}
							</Button>
						</Card>

						<Card size="small" title={t("接入指引")}>
							<Steps
								orientation="vertical"
								size="small"
								current={-1}
								items={[
									{ title: t("设备需已越狱"), content: t("Sileo 安装 deb，或用 install-ios.sh 通过 SSH 安装。") },
									{ title: t("左侧创建 token"), content: t("点显示/复制拿到 ios_... 值。") },
									{
										title: t("iPhone Safari 打开 setup 页"),
										content: t(
											"填控制台 wss 地址和 token；点“检测证书”，确认指纹一致后配对。",
										),
									},
									{
										title: t("设备出现在上方后打开「iOS」开关"),
										content: t("到对话页为当前对话打开开关，Agent 才能使用 ios_* 工具。"),
									},
								]}
							/>
						</Card>
					</Space>
				</Col>
			</Row>

			<Modal
				title={renaming ? t("重命名设备") : ""}
				open={renaming !== null}
				okText={t("保存")}
				cancelText={t("取消")}
				onCancel={() => setRenaming(null)}
				onOk={saveRename}
				destroyOnHidden
			>
				<Input
					autoFocus
					value={renaming?.name ?? ""}
					onChange={(event) => setRenaming((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
					onPressEnter={saveRename}
				/>
			</Modal>
		</Page>
	);
}

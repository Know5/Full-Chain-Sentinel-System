/**
 * The Android device page (左右分栏).
 *
 * Left column owns the service: the reverse listener (bind address/port, picked
 * by the operator) and the connection tokens. Right column owns the devices and
 * the onboarding steps. The Agent toolset switch deliberately does NOT live
 * here — it sits in the conversation, where the tools are actually used, and
 * stays off (no prompt, no tools) until explicitly enabled in that conversation.
 */

import { QrcodeOutlined, ReloadOutlined } from "@ant-design/icons";
import {
	Badge,
	Button,
	Card,
	Col,
	Input,
	Modal,
	Row,
	Select,
	Space,
	Steps,
	Tag,
	Typography,
} from "antd";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n.ts";
import type { DroidDevice, DroidToken, SentinelClientMessage } from "../types.ts";
import { Page } from "../ui/Page.tsx";

const { Text } = Typography;

function formatTime(iso: string | null): string {
	if (!iso) return "—";
	return iso.slice(0, 19).replace("T", " ");
}

export function DroidPage({
	connected,
	devices,
	tokens,
	listen,
	listenConfig,
	lanIps,
	consoleUrl,
	send,
}: {
	/** Requests may only go out on an open socket; before that the list stays empty. */
	connected: boolean;
	devices: DroidDevice[];
	tokens: DroidToken[];
	listen: { host: string; port: number } | null;
	listenConfig: { host: string; port: number } | null;
	lanIps: string[];
	consoleUrl: string;
	send(message: SentinelClientMessage): void;
}) {
	const [label, setLabel] = useState("");
	const [revealed, setRevealed] = useState<string | null>(null);
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
	const [listenHost, setListenHost] = useState("0.0.0.0");
	const [listenPort, setListenPort] = useState("9944");
	const [qrToken, setQrToken] = useState<DroidToken | null>(null);

	useEffect(() => {
		if (listenConfig) {
			setListenHost(listenConfig.host);
			setListenPort(String(listenConfig.port));
		}
	}, [listenConfig]);

	// The server only pushes `droid_state` when something changes, so a page that
	// merely opens shows whatever the last broadcast happened to carry — after a
	// browser reload that is nothing, and the token list stays empty until the
	// operator creates a token. Pull the state on mount and on every reconnect
	// (`connected` flips false → true), which is what the list is built from.
	useEffect(() => {
		if (connected) send({ type: "droid_state" });
	}, [connected, send]);

	// The address the phone should dial: the dedicated listener when bound, the
	// console origin otherwise. 0.0.0.0 is a bind address, not dialable — show the
	// machine's first LAN IPv4 and say so.
	const reverseAddress = (() => {
		if (listen) {
			const host = listen.host === "0.0.0.0" ? (lanIps[0] ?? "0.0.0.0") : listen.host;
			const note = listen.host === "0.0.0.0" && lanIps.length > 1 ? t("（多网卡，如不通请手改 IP）") : "";
			return { url: `ws://${host}:${listen.port}/ws/droid`, note };
		}
		return {
			url: consoleUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws/droid",
			note: t("（未启用独立监听，随控制台地址）"),
		};
	})();

	// 无响应的设备不能算在线：进程可能被挂起，socket 还开着但什么都不会回。
	const onlineCount = devices.filter((device) => device.online && !device.stale).length;

	const saveRename = () => {
		if (!renaming) return;
		const name = renaming.name.trim();
		if (name) send({ type: "droid_device_rename", id: renaming.id, name });
		setRenaming(null);
	};

	return (
		<Page
			title={t("安卓设备")}
			description={
				devices.length > 0
					? t("{online}/{total} 台在线", { online: onlineCount, total: devices.length })
					: t("DroidBridge 反连通道与设备管理")
			}
			extra={
				<Button icon={<ReloadOutlined />} onClick={() => send({ type: "droid_state" })}>
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
									placeholder="9944"
								/>
							</div>
							<Button
								type="primary"
								block
								disabled={!listenHost || !listenPort}
								onClick={() => send({ type: "droid_set_listen", host: listenHost, port: Number(listenPort) })}
							>
								{t("应用并重绑")}
							</Button>
							<Text type="secondary" className="droidhub-hint">
								{t("独立于控制台端口，应用立即生效；0.0.0.0 表示局域网内手机都可反连（仍需 token）。")}
							</Text>
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
									placeholder={t("名称，例如 测试机-一加")}
									onChange={(event) => setLabel(event.target.value)}
									onPressEnter={() => {
										if (!label.trim()) return;
										send({ type: "droid_token_create", label: label.trim() });
										setLabel("");
									}}
								/>
								<Button
									type="primary"
									onClick={() => {
										if (!label.trim()) return;
										send({ type: "droid_token_create", label: label.trim() });
										setLabel("");
									}}
								>
									{t("创建")}
								</Button>
							</div>

							{tokens.length === 0 ? (
								<Text type="secondary" className="droidhub-hint">
									{t("还没有 token。创建一个，填进手机上的 DroidBridge。")}
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
												<Button size="small" icon={<QrcodeOutlined />} onClick={() => setQrToken(token)}>
													{t("二维码")}
												</Button>
												<Button
													size="small"
													danger
													onClick={() => send({ type: "droid_token_delete", id: token.id })}
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
							{devices.length === 0 ? (
								<Text type="secondary" className="droidhub-hint">
									{t("还没有设备注册过。按右侧指引安装 DroidBridge 并反连。")}
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
													Android {device.androidVersion} (SDK {device.sdkInt})
												</Tag>
												<Tag color={device.rooted ? "green" : "default"} variant="filled">
													{device.rooted ? t("已 root") : t("未 root")}
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
												<Button
													size="small"
													onClick={() => setRenaming({ id: device.id, name: device.name })}
												>
													{t("重命名")}
												</Button>
												<Button
													size="small"
													danger
													onClick={() => send({ type: "droid_device_remove", id: device.id })}
												>
													{t("移除")}
												</Button>
											</Space>
										</div>
									))}
								</div>
							)}
						</Card>

						<Card size="small" title={t("接入指引")}>
							<Steps
								orientation="vertical"
								size="small"
								current={-1}
								items={[
									{
										title: t("创建一个 token"),
										content: t("左侧点「二维码」用手机扫，或点「显示/复制」手填。"),
									},
									{
										title: t("手机安装 DroidBridge"),
										content: (
											<>
												{t("构建产物在")} <Text code>packages/droid-apk</Text>
												{t("，填入地址与 token：")}
												<div className="droidhub-address">
													<Text code copyable>
														{reverseAddress.url}
													</Text>
													<Text type="secondary">{reverseAddress.note}</Text>
												</div>
											</>
										),
									},
									{ title: t("点「启动反连」"), content: t("Magisk 弹窗点允许。") },
									{
										title: t("设备出现在上方即接入成功"),
										content: t("到对话页为当前对话打开「安卓」开关，Agent 即可操控设备。"),
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

			{qrToken ? <TokenQrModal token={qrToken} address={reverseAddress.url} onClose={() => setQrToken(null)} /> : null}
		</Page>
	);
}

/** 每个 token 一枚二维码：内容 = 反连地址 + 该 token，DroidBridge 扫码即填入。 */
function TokenQrModal({ token, address, onClose }: { token: DroidToken; address: string; onClose(): void }) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		QRCode.toCanvas(canvas, `${address}?token=${token.token}`, { width: 220, margin: 1, errorCorrectionLevel: "M" }).catch(
			() => undefined,
		);
	}, [address, token.token]);
	return (
		<Modal
			open
			title={t("{name} 的接入二维码", { name: token.label })}
			footer={null}
			onCancel={onClose}
			width={420}
			destroyOnHidden
		>
			<div className="droidhub-qr">
				<canvas ref={canvasRef} />
				<Text code copyable className="droidhub-qr__value">{`${address}?token=${token.token}`}</Text>
				<Text type="secondary">{t("手机 DroidBridge 点「扫码填入」对准即可。")}</Text>
			</div>
		</Modal>
	);
}

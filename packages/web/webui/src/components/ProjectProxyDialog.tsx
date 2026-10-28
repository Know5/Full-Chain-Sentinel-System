/**
 * One project's proxy choice.
 *
 * The choice is a pointer, not a configuration: a project either follows the
 * default on the 代理 page, turns the proxy off for itself, or names one of the
 * profiles. A profile backed by a subscription has many nodes, so the project can
 * also name the node it wants — that pin belongs to the project, not to the
 * profile, because the same subscription is often shared by projects that should
 * leave through different exits.
 *
 * Saving only records the choice. The container keeps the network it was created
 * with until it is rebuilt, which the dialog says outright rather than leaving the
 * operator to wonder why nothing changed.
 */

import { Alert, Button, Descriptions, Input, Modal, Radio, Space, Steps, Typography } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";
import { AUTO_NODE_TAG, type SentinelProjectInfo, type SentinelProxyConfigView } from "../types.ts";
import { describeProfile } from "./ProxyPage.tsx";

const { Text } = Typography;

/** A project's stored choice, as the dialog's three states. */
export type ProjectProxyChoice =
	| { kind: "inherit" }
	| { kind: "off" }
	| { kind: "proxy"; id: string; nodeTag?: string };

export function projectProxyChoice(project: SentinelProjectInfo): ProjectProxyChoice {
	if (project.proxyId === undefined) return { kind: "inherit" };
	if (project.proxyId === null) return { kind: "off" };
	return { kind: "proxy", id: project.proxyId, nodeTag: project.proxyNode };
}

/** The `proxyId` a choice stores: absent for inherit, null for off. */
export function projectProxyId(choice: ProjectProxyChoice): string | null | undefined {
	if (choice.kind === "inherit") return undefined;
	if (choice.kind === "off") return null;
	return choice.id;
}

/** The `proxyNode` a choice stores: absent follows the profile's own node. */
export function projectProxyNode(choice: ProjectProxyChoice): string | undefined {
	return choice.kind === "proxy" ? choice.nodeTag : undefined;
}

type ProjectProxyProps = {
	project: SentinelProjectInfo;
	config: SentinelProxyConfigView;
	busy: boolean;
	onConfirm: (proxyId: string | null | undefined, proxyNode?: string) => void;
	onCancel: () => void;
};

export function ProjectProxyDialogBody({ project, config, busy, onConfirm, onCancel }: ProjectProxyProps) {
	const [nodeQuery, setNodeQuery] = useState("");
	const [step, setStep] = useState(1);
	const [choice, setChoice] = useState<ProjectProxyChoice>(() => {
		const initial = projectProxyChoice(project);
		// A project that named a profile which has since been deleted follows the
		// default again, so the dialog shows what will actually happen.
		if (initial.kind === "proxy" && !config.proxies.some((entry) => entry.id === initial.id)) {
			return { kind: "inherit" };
		}
		return initial;
	});
	const list = Array.isArray(config?.proxies) ? config.proxies : [];
	const defaultName = list.find((entry) => entry.id === config?.defaultId)?.name;
	const selectedProxy = choice.kind === "proxy" ? list.find((entry) => entry.id === choice.id) : undefined;
	const nodes =
		selectedProxy?.mode === "subscription" && Array.isArray(selectedProxy.nodes) ? selectedProxy.nodes : [];
	const query = nodeQuery.trim().toLocaleLowerCase();
	const filteredNodes = query
		? nodes.filter((node) => (node.name + " " + node.tag + " " + node.protocol).toLocaleLowerCase().includes(query))
		: nodes;
	const sourceName =
		choice.kind === "inherit"
			? t("跟随默认")
			: choice.kind === "off"
				? t("不使用代理")
				: (selectedProxy?.name ?? t("代理档案"));
	const nodeName =
		choice.kind !== "proxy"
			? t("此网络方式不单独选择节点")
			: choice.nodeTag === undefined
				? t("跟随档案默认（{name}）", {
						name:
							selectedProxy?.nodeTag === AUTO_NODE_TAG
								? t("自动择优")
								: (nodes.find((node) => node.tag === selectedProxy?.nodeTag)?.name ??
									nodes[0]?.name ??
									t("档案默认")),
					})
				: choice.nodeTag === AUTO_NODE_TAG
					? t("自动（按延迟择优）")
					: (nodes.find((node) => node.tag === choice.nodeTag)?.name ?? choice.nodeTag);

	return (
		<>
			<Steps
				size="small"
				current={step - 1}
				className="proxydlg-steps"
				items={[
					{ title: t("选择代理方式") },
					{ title: t("选择节点") },
					{ title: t("确认更改") },
				]}
			/>

			{step === 1 ? (
				<div className="proxydlg-panel">
					<Text type="secondary">{t("为项目选择代理来源：默认设置、直连或某个代理档案。")}</Text>
					<Radio.Group
						className="proxydlg-options"
						value={choice.kind === "proxy" ? `proxy:${choice.id}` : choice.kind}
						onChange={(event) => {
							const value = String(event.target.value);
							if (value === "inherit") setChoice({ kind: "inherit" });
							else if (value === "off") setChoice({ kind: "off" });
							else setChoice({ kind: "proxy", id: value.slice("proxy:".length), nodeTag: undefined });
						}}
					>
						<Space orientation="vertical" size={8} style={{ width: "100%" }}>
							<Radio value="inherit" className={choice.kind === "inherit" ? "proxydlg-card is-on" : "proxydlg-card"}>
								<Text strong>{t("跟随默认")}</Text>
								<Text type="secondary" className="proxydlg-card__text">
									{defaultName
										? t("当前默认：{name}；默认改了，这个项目也跟着改。", { name: defaultName })
										: t("当前默认是不使用代理；默认改了，这个项目也跟着改。")}
								</Text>
							</Radio>
							<Radio value="off" className={choice.kind === "off" ? "proxydlg-card is-on" : "proxydlg-card"}>
								<Text strong>{t("不使用代理")}</Text>
								<Text type="secondary" className="proxydlg-card__text">
									{t("这个项目的容器直接用宿主机或桥接网络，方便打内网、接反弹 shell。")}
								</Text>
							</Radio>
							{list.map((proxy) => {
								const selected = choice.kind === "proxy" && choice.id === proxy.id;
								const proxyNodes =
									proxy.mode === "subscription" && Array.isArray(proxy.nodes) ? proxy.nodes : [];
								return (
									<Radio
										key={proxy.id}
										value={`proxy:${proxy.id}`}
										className={selected ? "proxydlg-card is-on" : "proxydlg-card"}
									>
										<Text strong>{proxy.name}</Text>
										<Text type="secondary" className="proxydlg-card__text">
											{proxy.mode === "subscription"
												? proxyNodes.length > 0
													? t("{count} 个节点，可以只给这个项目指定一个", { count: proxyNodes.length })
													: t("订阅未拉取")
												: describeProfile(proxy)}
										</Text>
									</Radio>
								);
							})}
						</Space>
					</Radio.Group>
					{list.length === 0 ? (
						<Text type="secondary">{t("还没有代理：到侧栏「代理」页新建一个之后，这里才能选。")}</Text>
					) : null}
				</div>
			) : null}

			{step === 2 ? (
				<div className="proxydlg-panel">
					<Text strong>{t("选择出口节点")}</Text>
					<Text type="secondary">{t("当前代理：{name}", { name: sourceName })}</Text>
					{choice.kind === "proxy" && selectedProxy && nodes.length > 0 ? (
						<>
							<Input
								allowClear
								value={nodeQuery}
								placeholder={t("搜索 {count} 个节点", { count: nodes.length })}
								onChange={(event) => setNodeQuery(event.target.value)}
							/>
							<Text type="secondary">{t("可以指定固定节点，也可以跟随档案默认或按延迟自动择优。")}</Text>
							<Radio.Group
								className="proxydlg-options"
								value={
									choice.nodeTag === undefined
										? "default"
										: choice.nodeTag === AUTO_NODE_TAG
											? "auto"
											: choice.nodeTag
								}
								onChange={(event) => {
									const value = String(event.target.value);
									setChoice({
										kind: "proxy",
										id: selectedProxy.id,
										nodeTag: value === "default" ? undefined : value,
									});
								}}
							>
								<Space orientation="vertical" size={6} style={{ width: "100%" }}>
									<Radio value="default" className="proxydlg-card">
										<Text>
											{t("跟随档案默认（{name}）", {
												name:
													selectedProxy.nodeTag === AUTO_NODE_TAG
														? t("自动择优")
														: (nodes.find((node) => node.tag === selectedProxy.nodeTag)?.name ??
															nodes[0]?.name ??
															t("第一个节点")),
											})}
										</Text>
									</Radio>
									<Radio value="auto" className="proxydlg-card">
										<Text>{t("自动（按延迟择优）")}</Text>
									</Radio>
									{filteredNodes.map((node) => (
										<Radio key={node.tag} value={node.tag} className="proxydlg-card">
											<Space size={8} wrap>
												<Text>{node.name}</Text>
												{node.latencyMs === undefined ? (
													<Text type="secondary">{node.protocol}</Text>
												) : node.latencyMs === null ? (
													<Text type="danger">{t("超时")}</Text>
												) : (
													<Text type={node.latencyMs > 800 ? "warning" : "secondary"}>
														{node.latencyMs} ms
													</Text>
												)}
											</Space>
										</Radio>
									))}
								</Space>
							</Radio.Group>
							{filteredNodes.length === 0 ? (
								<Text type="secondary">{t("没有匹配的节点")}</Text>
							) : null}
						</>
					) : (
						<Text type="secondary">
							{choice.kind === "proxy"
								? t("这个代理档案没有可单独选择的节点，将使用档案自身的出口设置。")
								: t("当前网络方式不单独选择节点。需要指定节点时，请返回上一步选择支持节点的代理档案。")}
						</Text>
					)}
				</div>
			) : null}

			{step === 3 ? (
				<div className="proxydlg-panel">
					<Text strong>{t("确认项目代理设置")}</Text>
					<Descriptions
						size="small"
						column={1}
						bordered
						items={[
							{ key: "project", label: t("项目"), children: project.name },
							{ key: "source", label: t("代理来源"), children: sourceName },
							{ key: "node", label: t("出口节点"), children: nodeName },
							{ key: "scope", label: t("生效范围"), children: t("仅当前项目") },
						]}
					/>
					<Alert
						type="info"
						showIcon
						title={t(
							"只换节点会立刻生效，不用重建容器；换档案或改网络模式才需要重建（容器内 /work 之外的文件会丢，工作目录不受影响）。",
						)}
					/>
				</div>
			) : null}

			<Space size={8} className="proxydlg-actions">
				{step > 1 ? (
					<Button disabled={busy} onClick={() => setStep(step - 1)}>
						{t("上一步")}
					</Button>
				) : null}
				{step < 3 ? (
					<Button type="primary" onClick={() => setStep(step + 1)}>
						{t("下一步")}
					</Button>
				) : (
					<Button
						type="primary"
						loading={busy}
						disabled={busy}
						onClick={() => onConfirm(projectProxyId(choice), projectProxyNode(choice))}
					>
						{t("确认保存")}
					</Button>
				)}
				<Button onClick={onCancel}>{t("取消")}</Button>
			</Space>
		</>
	);
}

export function ProjectProxyDialog(props: ProjectProxyProps) {
	return (
		<Modal
			open
			width={680}
			onCancel={props.onCancel}
			footer={null}
			destroyOnHidden
			className="project-proxy-dialog"
			title={
				<Space size={8}>
					<Text strong>{t("项目代理")}</Text>
					<Text type="secondary">{props.project.name}</Text>
				</Space>
			}
		>
			<ProjectProxyDialogBody {...props} />
		</Modal>
	);
}

/**
 * The projects page.
 *
 * A project owns a work directory and the container that runs its tools, so
 * this is the console's root resource: creating, switching, stopping and
 * deleting them happens here, and every other page acts on the active one.
 *
 * Container and data are separate decisions: a container can be stopped or
 * thrown away while the project, its files and its records stay, and only the
 * data deletion takes those with it. The table is therefore about state, not
 * navigation: the primary button is always the action that applies to the
 * container's current state.
 */

import { DeleteOutlined, EllipsisOutlined, GlobalOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import type { ProColumns } from "@ant-design/pro-components";
import { Alert, App, Badge, Button, Dropdown, Form, Input, Modal, Radio, Space, Tag, Tooltip, Typography } from "antd";

import { useState } from "react";
import { t } from "../i18n.ts";
import type { SentinelProjectInfo, SentinelProxyConfigView } from "../types.ts";
import { Page } from "../ui/Page.tsx";
import { deleteConfirmMatches, PROJECT_REMOVE_OPTIONS } from "./ProjectDeleteDialog.tsx";
import { ProjectProxyDialog } from "./ProjectProxyDialog.tsx";

const { Text } = Typography;

function stateLabel(project: SentinelProjectInfo): string {
	if (project.state === "running") return t("运行中");
	if (project.state === "stopped") return project.manualStop ? t("已停止（手动）") : t("已停止");
	return t("无容器");
}

function stateStatus(project: SentinelProjectInfo): "success" | "default" | "warning" {
	if (project.state === "running") return "success";
	if (project.state === "stopped") return "default";
	return "warning";
}

function stateHint(project: SentinelProjectInfo): string {
	if (project.state === "running") return t("容器正在运行：停止后需要用「启动容器」重新启动");
	if (project.state === "stopped") {
		return project.manualStop
			? t("容器已被手动停止：进入该项目前需要点「启动容器」")
			: t("容器已停止：点「启动容器」即可重新启动，容器里的安装内容都还在");
	}
	return t("容器不存在：点「启动容器」会按当前设置重新创建");
}

/**
 * A container name shortened for the table: the full name repeats a prefix that
 * every project shares, so only the distinguishing head and tail are shown and
 * the full name goes in the tooltip.
 */
function shortContainer(name: string): string {
	return name.length > 18 ? `${name.slice(0, 13)}…${name.slice(-3)}` : name;
}

export function ProjectsPage({
	projects,
	activeProject,
	busy,
	proxyConfig,
	onCreate,
	onRecreate,
	onRemove,
	onStop,
	onStart,
	onSaveProxy,
}: {
	projects: SentinelProjectInfo[];
	activeProject: SentinelProjectInfo | null;
	busy: boolean;
	/** Proxy profiles and the default, for the row dialog. */
	proxyConfig: SentinelProxyConfigView;
	onCreate: (name: string) => Promise<string | null>;
	onRecreate: (id: string) => Promise<string | null>;
	onRemove: (id: string, confirmName: string, scope: "container" | "data") => Promise<string | null>;
	onStop: (id: string) => Promise<string | null>;
	onStart: (id: string) => Promise<string | null>;
	onSaveProxy: (id: string, proxyId: string | null | undefined, proxyNode?: string) => Promise<string | null>;
}) {
	const { message, modal } = App.useApp();
	/** Same reason as the header picker: an older server's payload must not blank the page. */
	const list = Array.isArray(projects) ? projects : [];
	const [error, setError] = useState<string | null>(null);
	const [actionBusy, setActionBusy] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [createForm] = Form.useForm<{ name: string }>();
	const [confirmName, setConfirmName] = useState("");
	const [scope, setScope] = useState<"container" | "data">("container");
	const [deleteFor, setDeleteFor] = useState<SentinelProjectInfo | null>(null);
	const [proxyFor, setProxyFor] = useState<SentinelProjectInfo | null>(null);

	const run = async (work: () => Promise<string | null>): Promise<boolean> => {
		setActionBusy(true);
		setError(null);
		const failure = await work();
		setActionBusy(false);
		if (failure) {
			setError(failure);
			return false;
		}
		return true;
	};

	const create = async () => {
		const name = createForm.getFieldValue("name")?.trim();
		if (!name) return;
		const ok = await run(() => onCreate(name));
		if (ok) {
			createForm.resetFields();
			setCreateOpen(false);
			message.success(t("项目已创建"));
		}
	};

	const start = (project: SentinelProjectInfo) => void run(() => onStart(project.id));

	const stop = (project: SentinelProjectInfo) => {
		modal.confirm({
			title: t("停止 {name} 的容器？", { name: project.name }),
			content: t("停止后，进入该项目前需要点「启动容器」。项目文件、会话和漏洞记录都会保留。"),
			okText: t("停止容器"),
			okButtonProps: { danger: true },
			cancelText: t("取消"),
			onOk: () => run(() => onStop(project.id)),
		});
	};

	const recreate = (project: SentinelProjectInfo) => {
		modal.confirm({
			title: t("重建 {name} 的容器？", { name: project.name }),
			content: t(
				"会按当前设置（网络模式、代理等）重新创建容器。项目文件挂载在宿主机上，不受影响；容器里手动安装的东西会丢失。",
			),
			okText: t("重建容器"),
			cancelText: t("取消"),
			onOk: () => run(() => onRecreate(project.id)),
		});
	};

	const openDelete = (project: SentinelProjectInfo) => {
		setConfirmName("");
		setScope("container");
		setDeleteFor(project);
	};

	const confirmDelete = async () => {
		if (!deleteFor) return;
		const ok = await run(() => onRemove(deleteFor.id, confirmName, scope));
		if (ok) {
			setDeleteFor(null);
			message.success(t("项目已删除"));
		}
	};

	const columns: ProColumns<SentinelProjectInfo>[] = [
		{
			title: t("项目"),
			dataIndex: "name",
			key: "name",
			render: (_, project) => {
				const active = project.id === activeProject?.id;
				return (
					<div className="project-cell">
						<div className="project-cell__title">
							<span className="project-cell__name">{project.name}</span>
							{active ? (
								<Tag color="blue" variant="filled">
									{t("当前")}
								</Tag>
							) : null}
							{project.proxyName ? (
								<Tooltip
									title={
										project.proxyNodeName
											? t("出网走代理「{name}」的节点「{node}」", {
													name: project.proxyName,
													node: project.proxyNodeName,
												})
											: t("出网走代理「{name}」", { name: project.proxyName })
									}
								>
									<Tag icon={<GlobalOutlined />} variant="filled" color="geekblue">
										{project.proxyNodeName ?? project.proxyName}
									</Tag>
								</Tooltip>
							) : null}
						</div>
						<div className="project-cell__meta">
							<Tooltip title={stateHint(project)}>
								<span className="project-cell__state">
									<Badge status={stateStatus(project)} />
									{stateLabel(project)}
								</span>
							</Tooltip>
							{project.container ? (
								<Tooltip title={project.container}>
									<code className="project-cell__container">{shortContainer(project.container)}</code>
								</Tooltip>
							) : null}
						</div>
					</div>
				);
			},
		},
		{
			title: t("会话"),
			dataIndex: "sessionCount",
			key: "sessions",
			width: 92,
			align: "right",
			render: (_, project) => <span className="project-num">{project.sessionCount ?? 0}</span>,
		},
		{
			title: t("漏洞"),
			dataIndex: "vulnCount",
			key: "vulns",
			width: 92,
			align: "right",
			render: (_, project) => <span className="project-num">{project.vulnCount ?? 0}</span>,
		},
		{
			title: t("操作"),
			key: "actions",
			width: 200,
			render: (_, project) => {
				const running = project.state === "running";
				return (
					<Space size={4}>
						{running ? (
							<Button
								size="small"
								danger
								type="text"
								icon={<StopOutlined />}
								disabled={busy || actionBusy}
								title={stateHint(project)}
								onClick={() => stop(project)}
							>
								{t("停止")}
							</Button>
						) : (
							<Button
								size="small"
								type="primary"
								icon={<PlayCircleOutlined />}
								disabled={busy || actionBusy}
								title={stateHint(project)}
								onClick={() => start(project)}
							>
								{t("启动")}
							</Button>
						)}
						<Dropdown
							trigger={["click"]}
							menu={{
								items: [
									{
										key: "recreate",
										icon: <ReloadOutlined />,
										label: t("重建容器"),
										onClick: () => recreate(project),
									},
									{
										key: "proxy",
										icon: <GlobalOutlined />,
										label: t("代理设置"),
										onClick: () => setProxyFor(project),
									},
									{ type: "divider" },
									{
										key: "delete",
										icon: <DeleteOutlined />,
										danger: true,
										label: t("删除项目"),
										onClick: () => openDelete(project),
									},
								],
							}}
						>
							<Button size="small" type="text" icon={<EllipsisOutlined />} aria-label={t("更多操作")} />
						</Dropdown>
					</Space>
				);
			},
		},
	];

	const runningCount = list.filter((project) => project.state === "running").length;
	const stoppedCount = list.length - runningCount;
	const sessionTotal = list.reduce((sum, project) => sum + (project.sessionCount ?? 0), 0);
	const vulnTotal = list.reduce((sum, project) => sum + (project.vulnCount ?? 0), 0);

	return (
		<Page
			title={t("项目")}
			description={t("每个项目拥有独立工作目录与容器；会话、漏洞和文件都按项目隔离。")}
			extra={
				<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
					{t("新建项目")}
				</Button>
			}
		>
			{error ? (
				<Alert
					type="error"
					showIcon
					closable
					className="ui-page__alert"
					message={error}
					onClose={() => setError(null)}
				/>
			) : null}

			<div className="projstats">
				<div className="projstats__item">
					<span className="projstats__value">{list.length}</span>
					<span className="projstats__label">{t("项目总数")}</span>
				</div>
				<div className="projstats__item">
					<span className="projstats__value is-on">{runningCount}</span>
					<span className="projstats__label">{t("容器运行中")}</span>
				</div>
				<div className="projstats__item">
					<span className="projstats__value">{stoppedCount}</span>
					<span className="projstats__label">{t("未运行")}</span>
				</div>
				<div className="projstats__item">
					<span className="projstats__value">{sessionTotal}</span>
					<span className="projstats__label">{t("会话")}</span>
				</div>
				<div className="projstats__item">
					<span className="projstats__value">{vulnTotal}</span>
					<span className="projstats__label">{t("漏洞记录")}</span>
				</div>
			</div>

			<ProTable<SentinelProjectInfo>
				rowKey="id"
				size="small"
				columns={columns}
				dataSource={list}
				search={false}
				options={false}
				pagination={false}
				toolbar={{
					title: (
						<Space size={6}>
							<Text strong>{t("项目列表")}</Text>
							<Text type="secondary">{t("{count} 个", { count: list.length })}</Text>
						</Space>
					),
				}}
				rowClassName={(project) => (project.id === activeProject?.id ? "project-row-active" : "")}
				locale={{
					emptyText: (
						<div className="project-empty">
							<Text strong>{t("还没有项目")}</Text>
							<Text type="secondary">{t("新建一个项目后，容器与工作目录才会就绪")}</Text>
						</div>
					),
				}}
			/>

			<div className="project-hints">
				<Text type="secondary">
					{t("项目工作目录挂载到容器的")} <code>/work</code>
					{t("，bash 与「文件」页看到的都是它。")}
				</Text>
				<Text type="secondary">
					{t("容器的网络模式、代理等创建期设置改完后，用「重建容器」让已有项目生效；删除项目不可恢复。")}
				</Text>
			</div>

			<Modal
				title={t("新建项目")}
				open={createOpen}
				okText={t("创建")}
				cancelText={t("取消")}
				confirmLoading={actionBusy}
				onOk={() => void create()}
				onCancel={() => setCreateOpen(false)}
				destroyOnHidden
			>
				<Form form={createForm} layout="vertical" onFinish={() => void create()}>
					<Form.Item
						name="name"
						label={t("项目名称")}
						rules={[{ required: true, message: t("请填写项目名称") }]}
						extra={t("项目名会用作容器和目录名，创建后不可修改。")}
					>
						<Input autoFocus placeholder={t("例如：客户内网")} onPressEnter={() => void create()} />
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				title={t("删除项目")}
				open={deleteFor !== null}
				okText={scope === "data" ? t("删除项目数据") : t("仅删除容器")}
				okButtonProps={{ danger: scope === "data", disabled: !deleteFor || !deleteConfirmMatches(confirmName, deleteFor.name) }}
				cancelText={t("取消")}
				confirmLoading={actionBusy}
				onOk={() => void confirmDelete()}
				onCancel={() => setDeleteFor(null)}
				destroyOnHidden
			>
				{deleteFor ? (
					<div className="project-delete">
						<Alert
							type="warning"
							showIcon
							message={t("删除 {name} 不可恢复", { name: deleteFor.name })}
							description={t("会话 {sessions} 个、漏洞 {vulns} 条会随项目数据一起消失。", {
								sessions: deleteFor.sessionCount ?? 0,
								vulns: deleteFor.vulnCount ?? 0,
							})}
						/>
						<Text type="secondary">{t("输入项目名确认：{name}", { name: deleteFor.name })}</Text>
						<Input
							autoFocus
							value={confirmName}
							onChange={(event) => setConfirmName(event.target.value)}
							placeholder={deleteFor.name}
						/>
						<Radio.Group value={scope} onChange={(event) => setScope(event.target.value as "container" | "data")}>
							<Space orientation="vertical">
								{PROJECT_REMOVE_OPTIONS.map((option) => (
									<Radio key={option.scope} value={option.scope}>
										{option.label}
										{option.danger ? (
											<Text type="danger" className="ui-hint">
												{" "}
												{t("连同工作目录、会话与漏洞记录")}
											</Text>
										) : null}
									</Radio>
								))}
							</Space>
						</Radio.Group>
					</div>
				) : null}
			</Modal>

			{proxyFor ? (
				<ProjectProxyDialog
					project={proxyFor}
					config={proxyConfig}
					busy={actionBusy}
					onCancel={() => setProxyFor(null)}
					onConfirm={(proxyId, proxyNode) => {
						const project = proxyFor;
						setProxyFor(null);
						if (project) void run(() => onSaveProxy(project.id, proxyId, proxyNode));
					}}
				/>
			) : null}
		</Page>
	);
}

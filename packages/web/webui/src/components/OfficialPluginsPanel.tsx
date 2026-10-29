import { ProTable } from "@ant-design/pro-components";
import type { ProColumns } from "@ant-design/pro-components";
import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { t } from "../i18n.ts";
import type {
	SentinelOfficialPluginView,
	SentinelPluginHostView,
	SentinelPluginView,
} from "../types.ts";
import { PluginIcon } from "./icons.tsx";

const { Text } = Typography;

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function versionOf(plugin: SentinelPluginView): string {
	return plugin.manifest.version;
}

/**
 * The curated catalog bundled with the console. A list, not a card grid: the
 * operator scans name/version/state in one column and acts from the row, which
 * stays readable when the catalog grows past a handful of plugins.
 */
export function OfficialPluginsPanel({
	plugins,
	installed,
	hosts,
	busy,
	onChoose,
}: {
	plugins: SentinelOfficialPluginView[];
	installed: SentinelPluginView[];
	hosts: SentinelPluginHostView[];
	busy: boolean;
	onChoose: (plugin: SentinelOfficialPluginView) => void;
}) {
	if (plugins.length === 0) {
		return (
			<Text type="secondary">{t("当前版本没有内置官方插件。")}</Text>
		);
	}

	return (
		<div className="op">
			<Text type="secondary">
				{t("随控制台分发的官方插件。安装时仍会选择目标主机，并确认构建许可与网络/能力权限。")}
			</Text>
			<ProTable<SentinelOfficialPluginView>
				rowKey={(plugin) => plugin.manifest.id}
				size="small"
				className="op__table"
				dataSource={plugins}
				search={false}
				options={false}
				pagination={false}
				tableLayout="fixed"
				scroll={{ x: 860 }}
				toolbar={{
					title: (
						<Space size={6}>
							<Text strong>{t("官方插件")}</Text>
							<Text type="secondary">{t("{count} 个", { count: plugins.length })}</Text>
						</Space>
					),
				}}
				columns={[
					{
						title: t("插件"),
						key: "name",
						render: (_, plugin) => {
							const manifest = plugin.manifest;
							return (
								<Space align="start" size={8}>
									<span className="op__icon">
										<PluginIcon size={17} />
									</span>
									<div className="op__text">
										<Space size={6}>
											<Text strong ellipsis>
												{manifest.name}
											</Text>
											<Tag color="blue" variant="filled">
												{t("官方")}
											</Tag>
										</Space>
										<Tooltip
											title={`${formatSize(plugin.sizeBytes)} · network ${manifest.permissions.network} · ${manifest.resources.memory}`}
										>
											<Text type="secondary" ellipsis>
												{manifest.description}
											</Text>
										</Tooltip>
									</div>
								</Space>
							);
						},
					},
					{
						title: t("版本"),
						key: "version",
						width: 90,
						render: (_, plugin) => <Text code>v{plugin.manifest.version}</Text>,
					},
					{
						title: t("工具"),
						key: "tools",
						width: 200,
						ellipsis: true,
						render: (_, plugin) => (
							<Text type="secondary" ellipsis>
								{plugin.manifest.tools
									.slice(0, 3)
									.map((tool) => tool.name)
									.join(" · ")}
								{plugin.manifest.tools.length > 3
									? ` +${plugin.manifest.tools.length - 3}`
									: ""}
							</Text>
						),
					},
					{
						title: t("状态"),
						key: "state",
						width: 150,
						render: (_, plugin) => {
							const mine = installed.filter((entry) => entry.manifest.id === plugin.manifest.id);
							const current = mine[0] ? versionOf(mine[0]) : null;
							const update = current !== null && current !== plugin.manifest.version;
							if (current === null) return <Text type="secondary">{t("未安装")}</Text>;
							if (update) {
								return (
									<Tag color="orange" variant="filled">
										{t("已装 v{current}，可更新", { current })}
									</Tag>
								);
							}
							return (
								<Tag color="green" variant="filled">
									{t("已安装")}
								</Tag>
							);
						},
					},
					{
						title: "",
						key: "actions",
						width: 200,
						render: (_, plugin) => {
							const mine = installed.filter((entry) => entry.manifest.id === plugin.manifest.id);
							const current = mine[0] ? versionOf(mine[0]) : null;
							const update = current !== null && current !== plugin.manifest.version;
							const label =
								current === null
									? t("安装")
									: update
										? t("更新到 v{version}", { version: plugin.manifest.version })
										: t("安装到其他主机");
							return (
								<Space size={8} wrap>
									<a href={plugin.manifest.source} target="_blank" rel="noreferrer">
										{t("源码")}
									</a>
									<Button
										type="primary"
										size="small"
										disabled={busy || hosts.length === 0}
										title={hosts.length === 0 ? t("先添加一个插件主机") : undefined}
										onClick={() => onChoose(plugin)}
									>
										{label}
									</Button>
								</Space>
							);
						},
					},
				]}
			/>
		</div>
	);
}

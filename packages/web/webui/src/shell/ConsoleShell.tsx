/**
 * The console shell: navigation rail, header, content area.
 *
 * The layout is the one the operator already knows — a dark rail on the left,
 * a light work area on the right — rebuilt on Ant Design primitives. What moved
 * is the session list: conversations are chat-scoped, so they live in the chat
 * page rail instead of growing the global navigation. The sider keeps only
 * navigation and the account/connection state.
 */

import {
	GithubOutlined,
	LogoutOutlined,
	MenuFoldOutlined,
	MenuUnfoldOutlined,
	ReloadOutlined,
	SettingOutlined,
	TranslationOutlined,
} from "@ant-design/icons";
import { Avatar, Badge, Button, Divider, Drawer, Dropdown, Grid, Layout, Menu, Tag, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import { useState, type ReactNode } from "react";
import { CONSOLE_VERSION, PROJECT_REPOSITORY } from "../branding.ts";
import { SentinelMark } from "../components/icons.tsx";
import { getLanguage, t } from "../i18n.ts";
import type { SentinelMode, SentinelPageId, SentinelProjectInfo } from "../types.ts";
import { SENTINEL_MODE_LABELS } from "../types.ts";
import { NAV_GROUPS, PAGE_TITLES, SETTINGS_CHILDREN, navLabel, type MenuEntry, type PluginNavEntry } from "./navigation.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export interface ConsoleShellProps {
	page: SentinelPageId;
	onNavigate: (page: SentinelPageId) => void;
	collapsed: boolean;
	onToggleCollapse: () => void;
	connected: boolean;
	mode: SentinelMode;
	authUser: string | null;
	modelConfigured: boolean;
	pendingApprovals: number;
	pendingVulns: number;
	pluginPages: PluginNavEntry[];
	projects: SentinelProjectInfo[];
	activeProject: SentinelProjectInfo | null;
	busy: boolean;
	onSwitchProject: (id: string) => void;
	onCreateProject: (name: string) => Promise<string | null>;
	onManageProjects: () => void;
	onRefresh: () => void;
	onLogout: () => void;
	onSwitchLanguage: (language: "zh" | "en") => void;
	children: ReactNode;
}

const MODE_COLORS: Record<SentinelMode, string> = {
	review: "default",
	ai: "purple",
	auto: "blue",
};

function entryToItem(entry: MenuEntry, badge: ReactNode): NonNullable<MenuProps["items"]>[number] {
	const Icon = entry.icon;
	return {
		key: entry.page,
		icon: <Icon />,
		title: entry.label,
		label: navLabel(entry.label, badge),
	};
}

export function ConsoleShell({
	page,
	onNavigate,
	collapsed,
	onToggleCollapse,
	connected,
	mode,
	authUser,
	modelConfigured,
	pendingApprovals,
	pendingVulns,
	pluginPages,
	projects,
	activeProject,
	busy,
	onSwitchProject,
	onCreateProject,
	onManageProjects,
	onRefresh,
	onLogout,
	onSwitchLanguage,
	children,
}: ConsoleShellProps) {
	const screens = Grid.useBreakpoint();
	const compact = screens.md === false;
	const [drawerOpen, setDrawerOpen] = useState(false);

	const badgeFor = (entry: MenuEntry): ReactNode => {
		if (entry.page === "settings.model" && !modelConfigured) {
			return (
				<Tooltip title={t("模型尚未配置")}>
					<Badge status="warning" />
				</Tooltip>
			);
		}
		const count = entry.page === "chat" ? pendingApprovals : entry.page === "vulns" ? pendingVulns : 0;
		return count > 0 ? <Badge count={count > 9 ? "9+" : count} size="small" /> : null;
	};

	const menuItems: MenuProps["items"] = [
		{
			type: "group",
			key: "workbench",
			label: <span className="console-nav-group">{t("工作台")}</span>,
			children: [
				...NAV_GROUPS[0].items.map((entry) => entryToItem(entry, badgeFor(entry))),
				...pluginPages.map(
					(plugin): NonNullable<MenuProps["items"]>[number] => ({
						key: plugin.page,
						title: plugin.title,
						disabled: plugin.disabled,
						icon: plugin.iconUrl ? (
							<img className="console-nav-plugin-icon" src={plugin.iconUrl} alt="" />
						) : (
							<SettingOutlined />
						),
						label: navLabel(plugin.label, null),
					}),
				),
			],
		},
		{
			type: "group",
			key: "system",
			label: <span className="console-nav-group">{t("系统")}</span>,
			children: [
				...NAV_GROUPS[1].items
					.filter((entry) => entry.page === "proxies")
					.map((entry) => entryToItem(entry, null)),
				{
					key: "settings",
					icon: <SettingOutlined />,
					title: t("设置"),
					label: t("设置"),
					popupClassName: "console-settings-popup",
					children: SETTINGS_CHILDREN.map((entry) => entryToItem(entry, null)),
				},
				...NAV_GROUPS[1].items
					.filter((entry) => entry.page === "about")
					.map((entry) => entryToItem(entry, null)),
			],
		},
	];

	const onMenuClick: MenuProps["onClick"] = ({ key }) => {
		onNavigate(key as SentinelPageId);
		setDrawerOpen(false);
	};

	const brand = (showTitle: boolean) => (
		<div className="console-brand">
			<span className="console-brand__mark">
				<SentinelMark size={18} />
			</span>
			{showTitle ? (
				<>
					<span className="console-brand__title">{t("全链哨兵")}</span>
					<Button
						type="text"
						size="small"
						className="console-brand__collapse"
						icon={<MenuFoldOutlined />}
						onClick={onToggleCollapse}
						aria-label={t("收起侧边栏")}
					/>
				</>
			) : null}
		</div>
	);

	const menu = (
		<Menu
			className="console-menu"
			mode="inline"
			theme="dark"
			items={menuItems}
			selectedKeys={[page]}
			defaultOpenKeys={page.startsWith("settings.") ? ["settings"] : []}
			onClick={onMenuClick}
		/>
	);

	const accountMenu: MenuProps = {
		items: [
			{ key: "who", label: authUser ?? t("未登录"), disabled: true },
			{ type: "divider" },
			{ key: "refresh", icon: <ReloadOutlined />, label: t("刷新当前页") },
			{ key: "language", icon: <TranslationOutlined />, label: t("切换语言") },
			{ key: "repo", icon: <GithubOutlined />, label: t("源码仓库") },
			...(authUser ? [{ type: "divider" as const }, { key: "logout", icon: <LogoutOutlined />, label: t("退出登录"), danger: true }] : []),
		],
		onClick: ({ key, domEvent }) => {
			domEvent.stopPropagation();
			if (key === "refresh") onRefresh();
			if (key === "language") onSwitchLanguage(getLanguage() === "zh" ? "en" : "zh");
			if (key === "repo") window.open(PROJECT_REPOSITORY, "_blank", "noopener,noreferrer");
			if (key === "logout") onLogout();
		},
	};

	const siderFooter = (showText: boolean) => (
		<div className="console-sider-footer">
			<div className="console-sider-footer__row">
				<span className={connected ? "console-dot is-on" : "console-dot"} />
				{showText ? <span className="console-sider-footer__text">{connected ? t("已连接") : t("已断开")}</span> : null}
				{showText ? <span className="console-sider-footer__version">v{CONSOLE_VERSION}</span> : null}
			</div>
		</div>
	);

	const header = (
		<Header className="console-header">
			<div className="console-header__left">
				{compact ? (
					<Button
						type="text"
						icon={<MenuUnfoldOutlined />}
						onClick={() => setDrawerOpen(true)}
						aria-label={t("打开导航")}
					/>
				) : null}
				<ProjectSwitcher
					projects={projects}
					activeProject={activeProject}
					busy={busy}
					onSwitch={onSwitchProject}
					onCreate={onCreateProject}
					onManage={onManageProjects}
				/>
				<Divider orientation="vertical" className="console-header__divider" />
				<span className="console-header__page">{page.startsWith("plugin:") ? t("插件") : (PAGE_TITLES[page] ?? t("控制台"))}</span>
				{connected ? <Tag color={MODE_COLORS[mode]}>{SENTINEL_MODE_LABELS[mode]}</Tag> : null}
			</div>
			<div className="console-header__right">
				<Badge
					status={connected ? "success" : "error"}
					text={<span className="console-header__conn">{connected ? t("已连接") : t("已断开")}</span>}
				/>
				<Tooltip title={t("刷新当前页")}>
					<Button type="text" icon={<ReloadOutlined />} onClick={onRefresh} aria-label={t("刷新当前页")} />
				</Tooltip>
				<Tooltip title={t("切换语言")}>
					<Button type="text" onClick={() => onSwitchLanguage(getLanguage() === "zh" ? "en" : "zh")}>
						{getLanguage() === "zh" ? "EN" : "中"}
					</Button>
				</Tooltip>
				<Dropdown menu={accountMenu} trigger={["click"]} placement="bottomRight">
					<Button type="text" className="console-account">
						<Avatar size={26} className="console-account__avatar">
							{(authUser ?? "?").slice(0, 1).toUpperCase()}
						</Avatar>
						<Text className="console-account__name">{authUser ?? t("未登录")}</Text>
					</Button>
				</Dropdown>
			</div>
		</Header>
	);

	return (
		<Layout className="console-shell">
			{compact ? (
				<Drawer
					open={drawerOpen}
					onClose={() => setDrawerOpen(false)}
					placement="left"
					width={264}
					closable={false}
					rootClassName="console-drawer"
					styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
				>
					<div className="console-drawer__inner">
						<div className="console-drawer__brand">
							<span className="console-brand__mark">
								<SentinelMark size={18} />
							</span>
							<span className="console-brand__title">{t("全链哨兵")}</span>
						</div>
						{menu}
						{siderFooter(true)}
					</div>
				</Drawer>
			) : (
				<Sider
					className="console-sider"
					width={232}
					collapsedWidth={64}
					collapsed={collapsed}
					trigger={null}
					collapsible
					theme="dark"
				>
					<div className="console-sider__inner">
						{brand(!collapsed)}
						<div className="console-sider__scroll">{menu}</div>
						{siderFooter(!collapsed)}
					</div>
				</Sider>
			)}

			<Layout className="console-main">
				{header}
				<Content className="console-content" inert={compact && drawerOpen}>
					<div className="console-page">{children}</div>
				</Content>
			</Layout>
		</Layout>
	);
}

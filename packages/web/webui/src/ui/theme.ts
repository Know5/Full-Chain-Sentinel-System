/**
 * The console's Ant Design theme.
 *
 * One direction: a dark navigation rail beside a light, data-dense work area.
 * The sider is intentionally the only dark surface, so the content reads as a
 * document and the navigation reads as chrome. Colors are set here and nowhere
 * else; page code must not hard-code hex values.
 *
 * `cssVar` is on so custom CSS (chat transcript, terminal, plugin frames) can
 * reuse the same tokens instead of duplicating the palette.
 */

import type { ThemeConfig } from "antd";

/** Seed colors shared by the theme and the few hand-written surfaces. */
export const CONSOLE_COLORS = {
	sider: "#0b1322",
	siderDeep: "#080f1c",
	primary: "#2563eb",
	primaryHover: "#3b82f6",
	primaryActive: "#1d4ed8",
	success: "#16a34a",
	warning: "#d97706",
	danger: "#dc2626",
	contentBg: "#f4f6f8",
	card: "#ffffff",
	border: "#e4e7ec",
	borderSoft: "#eef1f5",
	text: "#101828",
	textSecondary: "#475467",
	textTertiary: "#667085",
} as const;

const FONT_FAMILY =
	'-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif';

export const consoleTheme: ThemeConfig = {
	cssVar: { key: "sentinel" },
	hashed: false,
	token: {
		colorPrimary: CONSOLE_COLORS.primary,
		colorPrimaryHover: CONSOLE_COLORS.primaryHover,
		colorPrimaryActive: CONSOLE_COLORS.primaryActive,
		colorInfo: CONSOLE_COLORS.primary,
		colorLink: CONSOLE_COLORS.primary,
		colorSuccess: CONSOLE_COLORS.success,
		colorWarning: CONSOLE_COLORS.warning,
		colorError: CONSOLE_COLORS.danger,
		colorErrorHover: "#ef4444",
		colorBgLayout: CONSOLE_COLORS.contentBg,
		colorBgContainer: CONSOLE_COLORS.card,
		colorBgElevated: CONSOLE_COLORS.card,
		colorBorder: CONSOLE_COLORS.border,
		colorBorderSecondary: CONSOLE_COLORS.borderSoft,
		colorSplit: CONSOLE_COLORS.borderSoft,
		colorText: CONSOLE_COLORS.text,
		colorTextSecondary: CONSOLE_COLORS.textSecondary,
		colorTextTertiary: CONSOLE_COLORS.textTertiary,
		colorTextQuaternary: "#98a2b3",
		colorFillTertiary: "#f2f4f7",
		colorFillQuaternary: "#f8fafc",
		borderRadius: 8,
		borderRadiusLG: 12,
		borderRadiusSM: 6,
		borderRadiusXS: 4,
		controlHeight: 30,
		controlHeightSM: 24,
		controlHeightLG: 36,
		fontFamily: FONT_FAMILY,
		fontSize: 13,
		fontSizeSM: 12,
		lineHeight: 1.5,
		boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
		boxShadowSecondary: "0 12px 32px rgba(16, 24, 40, 0.12), 0 4px 12px rgba(16, 24, 40, 0.06)",
		boxShadowTertiary: "0 1px 2px rgba(16, 24, 40, 0.04)",
		motionDurationMid: "0.16s",
		wireframe: false,
	},
	components: {
		Layout: {
			bodyBg: CONSOLE_COLORS.contentBg,
			headerBg: CONSOLE_COLORS.card,
			headerHeight: 48,
			headerPadding: "0 14px",
			siderBg: CONSOLE_COLORS.sider,
			triggerBg: CONSOLE_COLORS.siderDeep,
			triggerColor: "rgba(226, 232, 240, 0.72)",
		},
		Menu: {
			itemBorderRadius: 8,
			itemHeight: 34,
			itemMarginInline: 8,
			itemMarginBlock: 1,
			iconSize: 16,
			collapsedIconSize: 18,
			groupTitleColor: "rgba(148, 163, 184, 0.8)",
			groupTitleFontSize: 10.5,
			darkItemBg: "transparent",
			darkSubMenuItemBg: "transparent",
			darkItemColor: "rgba(226, 232, 240, 0.72)",
			darkItemHoverBg: "rgba(148, 163, 184, 0.1)",
			darkItemHoverColor: "#ffffff",
			darkItemSelectedBg: "rgba(59, 130, 246, 0.2)",
			darkItemSelectedColor: "#ffffff",
			darkItemDisabledColor: "rgba(148, 163, 184, 0.35)",
			darkPopupBg: CONSOLE_COLORS.siderDeep,
		},
		Table: {
			headerBg: "#f8fafc",
			headerColor: CONSOLE_COLORS.textSecondary,
			headerSplitColor: "transparent",
			borderColor: CONSOLE_COLORS.borderSoft,
			rowHoverBg: "#f8faff",
			rowSelectedBg: "#eff4ff",
			rowSelectedHoverBg: "#e3edff",
			cellPaddingBlock: 6,
			cellPaddingInline: 12,
			headerBorderRadius: 8,
			footerBg: "transparent",
		},
		Card: {
			headerBg: "transparent",
			headerFontSize: 14,
			bodyPadding: 16,
			headerPadding: 16,
			headerHeight: 44,
		},
		Button: {
			fontWeight: 500,
			defaultShadow: "none",
			primaryShadow: "0 1px 2px rgba(37, 99, 235, 0.24)",
			dangerShadow: "0 1px 2px rgba(220, 38, 38, 0.2)",
			paddingInline: 12,
		},
		Tabs: {
			horizontalItemPadding: "8px 0",
			horizontalItemGutter: 20,
			titleFontSize: 14,
		},
		Modal: {
			titleFontSize: 16,
			headerBg: CONSOLE_COLORS.card,
			contentBg: CONSOLE_COLORS.card,
		},
		Segmented: {
			trackBg: "#f2f4f7",
			itemSelectedBg: CONSOLE_COLORS.card,
		},
		Descriptions: {
			labelBg: "#f8fafc",
			titleMarginBottom: 8,
		},
		Form: {
			labelColor: "#344054",
			labelFontSize: 13,
			itemMarginBottom: 12,
			verticalLabelPadding: "0 0 6px",
		},
		Input: {
			paddingBlock: 4,
			paddingInline: 10,
		},
		Select: {
			optionSelectedBg: "#eff4ff",
		},
		Tag: {
			defaultBg: "#f2f4f7",
			defaultColor: CONSOLE_COLORS.textSecondary,
		},
		Divider: {
			colorSplit: CONSOLE_COLORS.borderSoft,
		},
		Drawer: {
			paddingLG: 16,
		},
		Tooltip: {
			colorBgSpotlight: "#101828",
		},
		Badge: {
			textFontSizeSM: 11,
		},
	},
};

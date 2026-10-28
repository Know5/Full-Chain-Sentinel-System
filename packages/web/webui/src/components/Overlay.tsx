/**
 * A wide console overlay.
 *
 * 文件 and 子代理 are not pages of their own any more: they open from the chat
 * page toolbar and cover it, so the operator keeps one place to work from. The
 * shell is the same panel pattern the pages use, only floating.
 */

import { Button, Card, ConfigProvider, Space, Typography } from "antd";
import { t } from "../i18n.ts";

const { Text } = Typography;

export function Overlay({
	title,
	subtitle,
	actions,
	onClose,
	className,
	children,
}: {
	title: string;
	subtitle?: React.ReactNode;
	actions?: React.ReactNode;
	onClose: () => void;
	/** Extra class on the modal box, for panels that size themselves. */
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<ConfigProvider button={{ autoInsertSpace: false }}>
			<div className="overlay-layer" role="dialog" aria-modal="true">
				<div className="overlay-layer__scrim" onClick={onClose} />
				<Card
					size="small"
					className={className ? `overlay ${className}` : "overlay"}
					title={
						<Space size={8} wrap>
							<Text strong>{title}</Text>
							{subtitle ? <Text type="secondary">{subtitle}</Text> : null}
						</Space>
					}
					extra={
						<Space size={6}>
							{actions}
							<Button size="small" onClick={onClose} title={t("关闭")}>
								{t("关闭")}
							</Button>
						</Space>
					}
				>
					<div className="overlay__body">{children}</div>
				</Card>
			</div>
		</ConfigProvider>
	);
}

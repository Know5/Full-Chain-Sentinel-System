/**
 * A small centered confirmation dialog.
 *
 * Confirmations used to live inside the row (or inside the sidebar dropdown)
 * they belonged to, which forced a sentence, an input and several buttons into
 * a narrow strip of a table. A dialog gives each of those room, and it is the
 * same shape everywhere: a title that names the object, a short body, and the
 * decision in the footer.
 *
 * The footer is the caller's, because the decision is not always one button:
 * deleting a project is two buttons, each naming the scope it applies.
 */

import { Button, Card, ConfigProvider, Space, Typography } from "antd";
import { useEffect, type ReactNode } from "react";
import { t } from "../i18n.ts";

const { Text } = Typography;

export function ConfirmDialog({
	title,
	subtitle,
	className,
	footer,
	onCancel,
	children,
}: {
	title: string;
	className?: string;
	/** The object being acted on, so the dialog says what it is about. */
	subtitle?: ReactNode;
	/** The decision: one button for a plain confirmation, several for a choice. */
	footer: ReactNode;
	onCancel: () => void;
	children: ReactNode;
}) {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCancel();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onCancel]);

	return (
		<ConfigProvider button={{ autoInsertSpace: false }}>
		<div className="confirm-layer" role="dialog" aria-modal="true">
			<div className="confirm-layer__scrim" onClick={onCancel} />
			<Card
				size="small"
				className={className ? `confirm-card ${className}` : "confirm-card"}
				title={
					<Space size={8} wrap>
						<Text strong>{title}</Text>
						{subtitle ? <Text type="secondary">{subtitle}</Text> : null}
					</Space>
				}
				extra={
					<Button size="small" onClick={onCancel}>
						{t("关闭")}
					</Button>
				}
				actions={[
					<Button key="cancel" onClick={onCancel}>
						{t("取消")}
					</Button>,
					<Space key="decision" size={8}>
						{footer}
					</Space>,
				]}
			>
				{children}
			</Card>
		</div>
		</ConfigProvider>
	);
}

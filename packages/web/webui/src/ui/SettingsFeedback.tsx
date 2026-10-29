import { CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { t } from "../i18n.ts";
import "./settings-feedback.css";

/** A compact result; raw responses stay available without filling the form. */
export function SettingsFeedback({
	type,
	title,
	children,
	detail,
}: {
	type: "success" | "error" | "info";
	title: ReactNode;
	children?: ReactNode;
	detail?: string;
}) {
	return (
		<div className={`settings-feedback settings-feedback--${type}`} role={type === "error" ? "alert" : "status"}>
			<div className="settings-feedback__line">
				{type === "error" ? (
					<CloseCircleOutlined />
				) : type === "success" ? (
					<CheckCircleOutlined />
				) : (
					<InfoCircleOutlined />
				)}
				<div className="settings-feedback__copy">
					<span className="settings-feedback__title">{title}</span>
					{children && children !== title ? <span className="settings-feedback__message">{children}</span> : null}
				</div>
			</div>
			{detail ? (
				<details className="settings-feedback__details">
					<summary>{t("查看详情")}</summary>
					<pre>{detail}</pre>
				</details>
			) : null}
		</div>
	);
}

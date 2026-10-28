/**
 * 设置 → 安全: the console's administrator account.
 *
 * The password change goes straight over REST (it is about the HTTP session,
 * not about the agent conversation) and logs every other session out. Logout
 * lives in the sider footer; the server refuses tokens issued before it.
 */
import { Alert, Button, Card, Col, Form, Input, Row, Typography } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";

const { Text } = Typography;

export function SecurityPanel({ username }: { username: string | null }) {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		if (busy) return;
		setSaved(false);
		if (next !== confirm) {
			setError(t("两次输入的新密码不一致"));
			return;
		}
		setBusy(true);
		setError("");
		try {
			const response = await fetch("/api/auth/change-password", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ current, next }),
			});
			const data = (await response.json().catch(() => ({}))) as { error?: unknown };
			if (!response.ok) {
				setError(typeof data.error === "string" ? data.error : t("修改失败"));
				return;
			}
			setCurrent("");
			setNext("");
			setConfirm("");
			setSaved(true);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Row gutter={[16, 16]}>
			<Col xs={24} lg={14}>
				<Card size="small" title={t("修改密码")}>
					<Text type="secondary" className="security-hint">
						{t("至少 8 个字符。修改后其他已登录的会话（包括别的浏览器）会全部退出。")}
					</Text>
					<Form layout="vertical" className="security-form" onFinish={() => void submit()} requiredMark={false}>
						<Form.Item label={t("当前密码")} required>
							<Input.Password
								value={current}
								autoComplete="current-password"
								onChange={(event) => setCurrent(event.target.value)}
							/>
						</Form.Item>
						<Form.Item label={t("新密码")} required>
							<Input.Password
								value={next}
								autoComplete="new-password"
								onChange={(event) => setNext(event.target.value)}
							/>
						</Form.Item>
						<Form.Item label={t("确认新密码")} required>
							<Input.Password
								value={confirm}
								autoComplete="new-password"
								onChange={(event) => setConfirm(event.target.value)}
								onPressEnter={() => void submit()}
							/>
						</Form.Item>

						{error ? <Alert type="error" showIcon title={error} className="ui-page__alert" /> : null}
						{saved ? (
							<Alert type="success" showIcon title={t("密码已修改。")} className="ui-page__alert" />
						) : null}

						<Button
							type="primary"
							htmlType="submit"
							loading={busy}
							disabled={!current || !next}
						>
							{busy ? t("保存中…") : t("修改密码")}
						</Button>
					</Form>
				</Card>
			</Col>
			<Col xs={24} lg={10}>
				<Card size="small" title={t("当前登录")}>
					<Text strong className="security-account__name">
						{username ?? t("未知")}
					</Text>
					<Text type="secondary">
						{t("当前登录：{user}。退出登录在侧栏底部；修改后其他已登录的会话（包括别的浏览器）会全部退出。", {
							user: username ?? t("未知"),
						})}
					</Text>
				</Card>
			</Col>
		</Row>
	);
}

/**
 * The login screen.
 *
 * Shown instead of the console until the operator authenticates: on a fresh
 * install it is the account-creation form (setup), afterwards the login form.
 * The layout follows the reference: a dark brand panel on the left, the form on
 * the right. The left panel carries the animated skyline backdrop (see
 * LoginBackdrop) with the brand mark over it.
 */
import { GithubOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Form, Input, Typography } from "antd";
import { useState } from "react";
import {
	CONSOLE_VERSION,
	PROJECT_LICENSE,
	PROJECT_LICENSE_URL,
	PROJECT_NAME,
	PROJECT_REPOSITORY,
} from "../branding.ts";
import { t } from "../i18n.ts";
import { SentinelMark } from "./icons.tsx";
import { LanguageSwitch } from "./LanguageSwitch.tsx";
import { LoginBackdrop } from "./LoginBackdrop.tsx";

const { Title, Text, Link } = Typography;

export function AuthGate({ mode, onDone }: { mode: "setup" | "login"; onDone: () => void }) {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [remember, setRemember] = useState(true);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		if (busy) return;
		if (mode === "setup" && password !== confirm) {
			setError(t("两次输入的密码不一致"));
			return;
		}
		setBusy(true);
		setError("");
		try {
			const response = await fetch(`/api/auth/${mode}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username: username.trim(), password, remember }),
			});
			const data = (await response.json().catch(() => ({}))) as { error?: unknown };
			if (!response.ok) {
				setError(typeof data.error === "string" ? data.error : t("操作失败，请重试"));
				return;
			}
			onDone();
		} catch {
			setError(t("无法连接服务，请确认服务在运行"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="auth">
			<LanguageSwitch className="auth-language" />
			<div className="auth-visual">
				<LoginBackdrop />
				<div className="auth-brand">
					<span className="auth-brand-badge">
						<SentinelMark size={26} />
					</span>
					<span className="auth-brand-name">{t("全链哨兵")}</span>
				</div>
				<div className="auth-tagline">{t("授权渗透测试工作台")}</div>
			</div>
			<div className="auth-panel">
				<Card className="auth-card" variant="borderless">
					<Title level={3} className="auth-title">
						{mode === "setup" ? t("创建管理员账号") : t("登录到工作台")}
					</Title>
					<Text type="secondary">
						{mode === "setup" ? t("首次使用：设置管理员用户名与密码，之后用它登录。") : t("输入你的凭据以继续。")}
					</Text>

					<Form layout="vertical" className="auth-form" onFinish={() => void submit()} requiredMark={false}>
						<Form.Item label={t("用户名")} required>
							<Input
								value={username}
								autoComplete="username"
								autoFocus
								spellCheck={false}
								onChange={(event) => setUsername(event.target.value)}
							/>
						</Form.Item>
						<Form.Item label={t("密码")} required>
							<Input.Password
								value={password}
								autoComplete={mode === "setup" ? "new-password" : "current-password"}
								onChange={(event) => setPassword(event.target.value)}
								onPressEnter={() => {
									if (mode === "login") void submit();
								}}
							/>
						</Form.Item>
						{mode === "setup" ? (
							<Form.Item label={t("确认密码")} required>
								<Input.Password
									value={confirm}
									autoComplete="new-password"
									onChange={(event) => setConfirm(event.target.value)}
									onPressEnter={() => void submit()}
								/>
							</Form.Item>
						) : (
							<Form.Item>
								<Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)}>
									{t("记住登录 30 天")}
								</Checkbox>
							</Form.Item>
						)}

						{error ? <Alert type="error" showIcon title={error} className="ui-page__alert" /> : null}

						<Button
							type="primary"
							htmlType="submit"
							block
							size="large"
							loading={busy}
							disabled={!username.trim() || !password}
						>
							{mode === "setup" ? t("创建并登录") : t("登录")}
						</Button>
					</Form>

					<div className="auth-foot">
						<Text type="secondary">
							{PROJECT_NAME} · v{CONSOLE_VERSION}
						</Text>
						<span className="auth-foot__links">
							<Link href={PROJECT_REPOSITORY} target="_blank" rel="noreferrer">
								<GithubOutlined /> GitHub
							</Link>
							<Link href={PROJECT_LICENSE_URL} target="_blank" rel="noreferrer">
								{PROJECT_LICENSE}
							</Link>
						</span>
						<Text type="secondary" className="auth-foot__note">
							{t("密码只以哈希存在本机")}
						</Text>
					</div>
				</Card>
			</div>
		</div>
	);
}

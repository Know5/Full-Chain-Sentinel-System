/**
 * The first-visit authorization promise.
 *
 * Rendered instead of the console until the operator accepts the statement. The
 * text comes from the server (`/api/consent`), so the wording shown here is the
 * same wording that was hashed and stored; the client never carries its own copy
 * that could drift from what was agreed to.
 *
 * The promise is the only way forward: the button stays disabled until the
 * checkbox is ticked, and declining leaves the console closed. Acceptance is
 * recorded server-side, so this is a gate rather than a reminder.
 */
import { Alert, Button, Card, Checkbox, Result, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { PROJECT_LICENSE, PROJECT_LICENSE_URL, PROJECT_REPOSITORY } from "../branding.ts";
import { t } from "../i18n.ts";
import { SentinelMark } from "./icons.tsx";
import { LanguageSwitch } from "./LanguageSwitch.tsx";

const { Title, Text, Link } = Typography;

interface ConsentClause {
	title: string;
	body: string;
}

interface ConsentText {
	title: string;
	subtitle: string;
	intro: string;
	clauses: ConsentClause[];
	illegal: string;
	aiTitle: string;
	ai: string[];
	promise: string;
	ack: string;
	footnote: string;
}

/**
 * `**emphasis**` becomes `<strong>`. The statement is data, not markup, so this
 * splits on the marker instead of injecting HTML.
 */
function emphasized(text: string): ReactNode[] {
	return text.split("**").map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part));
}

export function ConsentGate({ onAccepted }: { onAccepted: () => void }) {
	const [text, setText] = useState<ConsentText | null>(null);
	const [checked, setChecked] = useState(false);
	const [busy, setBusy] = useState(false);
	const [rejected, setRejected] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const response = await fetch("/api/consent");
				const data = (await response.json().catch(() => ({}))) as { text?: ConsentText };
				if (cancelled) return;
				if (!response.ok || !data.text) {
					setError(t("无法读取承诺条款，请刷新页面重试"));
					return;
				}
				setText(data.text);
			} catch {
				if (!cancelled) setError(t("无法连接服务，请确认服务在运行"));
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	const accept = async () => {
		if (busy || !checked) return;
		setBusy(true);
		setError("");
		try {
			const response = await fetch("/api/consent/accept", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ accepted: true }),
			});
			if (!response.ok) {
				const data = (await response.json().catch(() => ({}))) as { error?: unknown };
				setError(typeof data.error === "string" ? data.error : t("记录承诺失败，请重试"));
				return;
			}
			onAccepted();
		} catch {
			setError(t("无法连接服务，请确认服务在运行"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="consent">
			<LanguageSwitch className="consent-language" />
			<Card className="consent-card" variant="borderless">
				{rejected ? (
					<Result
						status="warning"
						title={t("已拒绝，无法进入平台")}
						subTitle={t("未勾选承诺时平台不提供任何功能。关闭页面即可；如果改变主意，可以重新阅读并接受。")}
						extra={
							<Button type="primary" onClick={() => setRejected(false)}>
								{t("重新阅读并接受")}
							</Button>
						}
					/>
				) : (
					<>
						<div className="consent-head">
							<span className="consent-mark">
								<SentinelMark size={24} />
							</span>
							<div>
								<Title level={3} className="consent-title">
									{text?.title ?? t("授权与风险承诺")}
								</Title>
								<Text type="secondary">
									{text?.subtitle ?? t("首次使用前必须阅读并勾选承诺，否则无法进入平台")}
								</Text>
							</div>
						</div>

						<div className="consent-body">
							{text ? (
								<>
									<Text className="consent-lead">{emphasized(text.intro)}</Text>
									<ol className="consent-terms">
										{text.clauses.map((clause, index) => (
											<li key={clause.title}>
												<Text strong className="consent-clause-title">
													<Tag variant="filled">{String(index + 1).padStart(2, "0")}</Tag>
													{clause.title}
												</Text>
												<Text>{emphasized(clause.body)}</Text>
											</li>
										))}
									</ol>

									<Alert type="warning" showIcon className="ui-page__alert" title={emphasized(text.illegal)} />

									<Card
										size="small"
										className="consent-ai"
										title={
											<Space size={8}>
												<Tag color="purple" variant="filled">
													AI
												</Tag>
												{text.aiTitle}
											</Space>
										}
									>
										<ul>
											{text.ai.map((line) => (
												<li key={line}>{emphasized(line)}</li>
											))}
										</ul>
									</Card>

									<Text type="secondary" className="consent-note">
										{text.footnote}
									</Text>
									{/* Presentation, not part of the hashed promise: adding this line must not
									    invalidate an acceptance the operator already made. */}
									<Text type="secondary" className="consent-source">
										{t("本项目以 {license} 许可开源", { license: PROJECT_LICENSE })}
										{" · "}
										<Link href={PROJECT_REPOSITORY} target="_blank" rel="noreferrer">
											{t("查看源码与许可证")}
										</Link>
										{" · "}
										<Link href={PROJECT_LICENSE_URL} target="_blank" rel="noreferrer">
											{PROJECT_LICENSE}
										</Link>
									</Text>
								</>
							) : (
								<Space>
									<Spin />
									<Text type="secondary">{error || t("正在读取承诺条款…")}</Text>
								</Space>
							)}
							{error && text ? <Alert type="error" showIcon title={error} className="ui-page__alert" /> : null}
						</div>

						<div className="consent-foot">
							<Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)}>
								<Text strong>{text?.promise ?? t("我承诺只用于授权合法的渗透测试")}</Text>
								{text?.ack ? (
									<>
										<br />
										<Text type="secondary">{text.ack}</Text>
									</>
								) : null}
							</Checkbox>
							<Space className="consent-actions" size={8}>
								<Button
									type="primary"
									size="large"
									disabled={!checked || busy || !text}
									loading={busy}
									onClick={() => void accept()}
								>
									{t("进入平台")}
								</Button>
								<Button size="large" onClick={() => setRejected(true)}>
									{t("不同意，退出")}
								</Button>
							</Space>
							<Text type={checked ? "success" : "secondary"} className="consent-hint">
								{checked ? t("已确认，可以进入平台") : t("请先勾选承诺，否则无法进入平台")}
							</Text>
						</div>
					</>
				)}
			</Card>
		</div>
	);
}

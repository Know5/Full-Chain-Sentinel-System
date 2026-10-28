/**
 * A boundary around the page area.
 *
 * A render error used to take the whole console down to a blank screen, which
 * says nothing about what broke. This keeps the shell (sidebar, connection
 * banner) alive and shows the error message with a way back, so a bad field in
 * one page's data costs that page and not the session.
 *
 * Only render errors are caught here: an error thrown in an event handler or a
 * promise still reaches the console, which is where it is useful.
 */

import { Button, Card, Result, Space, Typography } from "antd";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n.ts";

const { Text } = Typography;

export function PageErrorCard({
	message,
	onRetry,
	onHome,
}: {
	message: string;
	onRetry: () => void;
	onHome?: () => void;
}) {
	return (
		<Card size="small" className="page-error-card">
			<Result
				status="error"
				title={t("这个页面出错了")}
				subTitle={t(
					"页面渲染时抛出了下面的错误。切到别的页面或点「重试」可以继续用；错误详情也会打印在浏览器控制台。",
				)}
				extra={
					<Space size={8}>
						<Button type="primary" onClick={onRetry}>
							{t("重试")}
						</Button>
						{onHome ? <Button onClick={onHome}>{t("回到工作台")}</Button> : null}
					</Space>
				}
			>
				<pre className="page-error-card__detail">{message}</pre>
			</Result>
		</Card>
	);
}

export class PageBoundary extends Component<
	{ children: ReactNode; onHome?: () => void },
	{ message: string | null }
> {
	state: { message: string | null } = { message: null };

	/** React asks for the next state, so the fallback renders on the same pass. */
	static getDerivedStateFromError(error: unknown): { message: string } {
		return { message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
	}

	componentDidCatch(error: unknown, info: ErrorInfo): void {
		// Keep the stack for whoever opens the console; the card only shows the
		// message, because a stack is unreadable at that size.
		console.error("[page-error]", error, info.componentStack);
	}

	render(): ReactNode {
		if (this.state.message !== null) {
			return (
				<PageErrorCard
					message={this.state.message}
					onRetry={() => this.setState({ message: null })}
					onHome={
						this.props.onHome
							? () => {
									this.setState({ message: null });
									this.props.onHome?.();
								}
							: undefined
					}
				/>
			);
		}
		return this.props.children;
	}
}

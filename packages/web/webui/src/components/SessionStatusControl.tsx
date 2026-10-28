/**
 * The operator's manual session status.
 *
 * Ten tasks in flight are indistinguishable in a list sorted by time, so each
 * session carries a label the operator sets: 待跟进 needs a nudge, 进行中 is being
 * worked on, 已完成 can be forgotten, 已忽略 is parked. It lives in the session
 * file as a `custom` entry, so it survives a restart and a fork, and it is never
 * sent to the model — the agent has no business reacting to the operator's own
 * bookkeeping.
 *
 * The chip appears in the session list and the toolbar, and both open the same
 * picker. The picker is `position: fixed` from the trigger's rect: the list is a
 * scroll container and the sider clips, so an absolutely positioned panel would
 * be cut off on the last rows.
 */

import { Button, Popover, Space } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";
import type { SentinelSessionStatus } from "../types.ts";

export const SESSION_STATUSES: readonly SentinelSessionStatus[] = ["todo", "active", "done", "ignored"];

export const SESSION_STATUS_LABELS: Record<SentinelSessionStatus, string> = {
	todo: t("待跟进"),
	active: t("进行中"),
	done: t("已完成"),
	ignored: t("已忽略"),
};

function chipClass(status: SentinelSessionStatus | null | undefined): string {
	return `session-status-chip ${status ?? "none"}`;
}

/** The status as a small colored label, or a muted one when it is unset. */
export function SessionStatusChip({ status }: { status?: SentinelSessionStatus }) {
	return <span className={chipClass(status)}>{status ? SESSION_STATUS_LABELS[status] : t("无状态")}</span>;
}

/**
 * How a session row carries its manual status: a 2px rail at the row's left edge
 * whose color matches the status, plus the label for the two terminal statuses.
 *
 * The rail covers every set status — it used to be drawn for 待跟进/进行中 only, so
 * marking a session 已完成/已忽略 changed nothing visible in the list and looked
 * like the mark had not been saved. A color alone cannot tell 已完成 from 已忽略,
 * so those two also carry the label; 待跟进/进行中 stay label-free because the
 * rail is the attention cue there and the list stays compact.
 */
export function SessionStatusRail({ status }: { status?: SentinelSessionStatus | null }) {
	if (!status) return null;
	const terminal = status === "done" || status === "ignored";
	return (
		<>
			<span className={`status-rail rail-${status}`} title={t("人工标记：{status}", { status: SESSION_STATUS_LABELS[status] })} />
			{terminal ? <span className={`session-row-status row-${status}`}>{SESSION_STATUS_LABELS[status]}</span> : null}
		</>
	);
}

/**
 * A chip (session list) or button (toolbar) that opens the status picker.
 * `onPick(null)` clears the status.
 */
export function SessionStatusControl({
	status,
	variant,
	onPick,
	onOpenChange,
}: {
	status?: SentinelSessionStatus | null;
	variant: "chip" | "toolbar";
	onPick: (status: SentinelSessionStatus | null) => void;
	/**
	 * Whether the picker is open. A host that hides itself when the pointer
	 * leaves (the session list's hover card) uses this to stay alive while the
	 * panel is up; without it the card unmounts on the way to the panel and the
	 * statuses cannot be clicked at all.
	 */
	onOpenChange?: (open: boolean) => void;
}) {
	const [open, setOpen] = useState(false);

	const pick = (next: SentinelSessionStatus | null) => {
		setOpen(false);
		onOpenChange?.(false);
		onPick(next);
	};

	const trigger = (
		<button
			type="button"
			className={variant === "toolbar" ? `session-status-trigger ${status ?? "none"}` : chipClass(status)}
			title={t("人工标记这个会话的状态：只影响控制台显示与过滤，不会告诉模型")}
			onClick={(event) => {
				// The session row behind the chip switches sessions on click.
				event.stopPropagation();
			}}
		>
			{variant === "toolbar" ? (
				<>
					<span className={`session-status-dot ${status ?? "none"}`} />
					{status ? SESSION_STATUS_LABELS[status] : t("无状态")}
					<span className="session-status-caret">▾</span>
				</>
			) : (
				<>
					{status ? SESSION_STATUS_LABELS[status] : t("无状态")}
					<span className="session-status-caret">▾</span>
				</>
			)}
		</button>
	);

	return (
		<span
			className="session-status-control"
			onClick={(event) => event.stopPropagation()}
		>
			<Popover
				open={open}
				trigger="click"
				placement={variant === "toolbar" ? "bottomRight" : "bottomLeft"}
				onOpenChange={(next) => {
					setOpen(next);
					onOpenChange?.(next);
				}}
				content={
					<Space orientation="vertical" size={2} className="session-status-picker">
						<Button
							type={status ? "text" : "primary"}
							block
							size="small"
							onClick={() => pick(null)}
						>
							<Space size={6}>
								<span className="session-status-dot none" />
								{t("无状态")}
								{status ? null : <span className="session-status-tick">✓</span>}
							</Space>
						</Button>
						{SESSION_STATUSES.map((value) => (
							<Button
								key={value}
								type={status === value ? "primary" : "text"}
								block
								size="small"
								onClick={() => pick(value)}
							>
								<Space size={6}>
									<span className={`session-status-dot ${value}`} />
									{SESSION_STATUS_LABELS[value]}
									{status === value ? <span className="session-status-tick">✓</span> : null}
								</Space>
							</Button>
						))}
					</Space>
				}
			>
				{trigger}
			</Popover>
		</span>
	);
}

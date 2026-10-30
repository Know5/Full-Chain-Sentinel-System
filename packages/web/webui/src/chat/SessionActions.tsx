import { CheckOutlined, DeleteOutlined, EditOutlined, MoreOutlined } from "@ant-design/icons";
import { Button, Popover } from "antd";
import { useState } from "react";
import { SESSION_STATUSES, SESSION_STATUS_LABELS } from "../components/SessionStatusControl.tsx";
import { t } from "../i18n.ts";
import type { SentinelSessionStatus } from "../types.ts";

export function SessionActions({
	status,
	onRename,
	onDelete,
	onSetStatus,
}: {
	status?: SentinelSessionStatus;
	onRename: () => void;
	onDelete: () => void;
	onSetStatus: (status: SentinelSessionStatus | null) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<span className="session-row__actions" onClick={(event) => event.stopPropagation()}>
			<Popover
				open={open}
				onOpenChange={setOpen}
				trigger="click"
				placement="bottomRight"
				arrow={false}
				destroyOnHidden
				classNames={{ container: "session-actions-surface" }}
				content={
					<div className="session-actions" role="group" aria-label={t("会话操作")} onKeyDown={(event) => {
						if (event.key === "Escape") setOpen(false);
					}}>
						<Button type="text" size="small" block icon={<EditOutlined />} className="session-actions__command" onClick={() => {
							setOpen(false);
							onRename();
						}}>{t("重命名")}</Button>
						<div className="session-actions__status">
							<div className="session-actions__heading">
								<span>{t("标记状态")}</span>
								<Button type="text" size="small" disabled={!status} onClick={() => {
									setOpen(false);
									onSetStatus(null);
								}}>{t("清除标记")}</Button>
							</div>
							<div className="session-actions__grid">
								{SESSION_STATUSES.map((value) => (
									<Button key={value} type="text" size="small" aria-pressed={status === value} className={`session-actions__mark mark-${value}`} onClick={() => {
										setOpen(false);
										onSetStatus(value);
									}}>
										<span className="session-actions__dot" />
										{SESSION_STATUS_LABELS[value]}
										{status === value ? <CheckOutlined className="session-actions__check" /> : null}
									</Button>
								))}
							</div>
						</div>
						<Button type="text" size="small" block danger icon={<DeleteOutlined />} className="session-actions__command" onClick={() => {
							setOpen(false);
							onDelete();
						}}>{t("删除会话")}</Button>
					</div>
				}
			>
				<Button type="text" size="small" className="session-row__more" icon={<MoreOutlined />} aria-label={t("会话操作")} />
			</Popover>
		</span>
	);
}

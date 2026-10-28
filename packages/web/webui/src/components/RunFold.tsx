import { DownOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";
import { t } from "../i18n.ts";

/**
 * The single row that stands for one finished run's process. A recon run is
 * dozens of tool calls and several rounds of thinking; once it has settled, the
 * operator wants the answer, not the transcript of how it got there. Expanding
 * this row puts the whole process back, in order.
 */
export function RunFold({ digest, open, onToggle }: { digest: string; open: boolean; onToggle: () => void }) {
	return (
		<Button
			type="text"
			size="small"
			className="runfold"
			onClick={onToggle}
			icon={open ? <DownOutlined /> : <RightOutlined />}
		>
			{open ? t("收起过程") : t("过程")}
			{digest ? (
				<Typography.Text type="secondary" ellipsis className="runfold__digest">
					{digest}
				</Typography.Text>
			) : null}
		</Button>
	);
}

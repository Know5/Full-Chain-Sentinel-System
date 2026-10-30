import { Form, Select } from "antd";
import { t } from "../i18n.ts";
import { AUTO_NODE_TAG, type SentinelProxyConfigView } from "../types.ts";
import type { ProjectProxyChoice } from "./ProjectProxyDialog.tsx";

/** Compact proxy selection shared by all project creation entry points. */
export function ProjectProxyFields({
	config,
	choice,
	disabled,
	onChange,
}: {
	config: SentinelProxyConfigView;
	choice: ProjectProxyChoice;
	disabled: boolean;
	onChange: (choice: ProjectProxyChoice) => void;
}) {
	const defaultProxy = config.proxies.find((proxy) => proxy.id === config.defaultId);
	const selected = choice.kind === "proxy" ? config.proxies.find((proxy) => proxy.id === choice.id) : undefined;

	return (
		<>
			<Form.Item
				label={t("代理设置")}
				extra={config.proxies.length === 0 ? t("还没有代理：到侧栏「代理」页新建一个之后，这里才能选。") : undefined}
			>
				<Select<string>
					aria-label={t("代理设置")}
					style={{ width: "100%" }}
					disabled={disabled}
					value={choice.kind === "proxy" ? `proxy:${choice.id}` : choice.kind}
					options={[
						{ value: "inherit", label: `${t("跟随默认")} · ${defaultProxy?.name ?? t("不使用代理")}` },
						{ value: "off", label: t("不使用代理") },
						...config.proxies.map((proxy) => ({ value: `proxy:${proxy.id}`, label: proxy.name })),
					]}
					onChange={(value) => {
						if (value === "inherit") onChange({ kind: "inherit" });
						else if (value === "off") onChange({ kind: "off" });
						else onChange({ kind: "proxy", id: value.slice("proxy:".length) });
					}}
				/>
			</Form.Item>
			{selected?.mode === "subscription" && choice.kind === "proxy" ? (
				<Form.Item label={t("出口节点")}>
					<Select<string>
						aria-label={t("出口节点")}
						style={{ width: "100%" }}
						disabled={disabled}
						showSearch={{ optionFilterProp: "label" }}
						value={choice.nodeTag === undefined ? "inherit" : `node:${choice.nodeTag}`}
						options={[
							{
								value: "inherit",
								label: t("跟随档案默认（{name}）", {
									name: selected.nodeTag === AUTO_NODE_TAG
										? t("自动择优")
										: (selected.nodes.find((node) => node.tag === selected.nodeTag)?.name ?? t("第一个节点")),
								}),
							},
							{ value: `node:${AUTO_NODE_TAG}`, label: t("自动（按延迟择优）") },
							...selected.nodes.map((node) => ({ value: `node:${node.tag}`, label: node.name })),
						]}
						onChange={(value) => onChange({
							kind: "proxy",
							id: selected.id,
							nodeTag: value === "inherit" ? undefined : value.slice("node:".length),
						})}
					/>
				</Form.Item>
			) : null}
		</>
	);
}

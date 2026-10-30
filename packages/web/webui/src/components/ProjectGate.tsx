/**
 * Blocking onboarding shown while no project is selected. The console runs every
 * tool inside a project container, so there is deliberately no default directory
 * to chat from.
 */

import { FolderOpenOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, List, Typography } from "antd";
import { useState } from "react";
import { t } from "../i18n.ts";
import type { SentinelProjectInfo, SentinelProxyConfigView } from "../types.ts";
import { type ProjectProxyChoice, projectProxyId, projectProxyNode } from "./ProjectProxyDialog.tsx";
import { ProjectProxyFields } from "./ProjectProxyFields.tsx";

const { Title, Text } = Typography;

export function ProjectGate({
	projects,
	busy,
	proxyConfig,
	onCreate,
	onSwitch,
	onOpenSettings,
}: {
	projects: SentinelProjectInfo[];
	busy: boolean;
	proxyConfig: SentinelProxyConfigView;
	onCreate: (name: string, proxyId?: string | null, proxyNode?: string) => Promise<string | null>;
	onSwitch: (id: string) => void;
	onOpenSettings: () => void;
}) {
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [createProxy, setCreateProxy] = useState<ProjectProxyChoice>({ kind: "inherit" });

	const submit = async () => {
		if (!name.trim() || submitting || busy) return;
		setSubmitting(true);
		setError(null);
		const message = await onCreate(name.trim(), projectProxyId(createProxy), projectProxyNode(createProxy));
		setSubmitting(false);
		if (message) {
			setError(message);
			return;
		}
		setName("");
		setCreateProxy({ kind: "inherit" });
	};

	return (
		<div className="gate-page">
			<Card className="gate-card" variant="borderless">
				<Title level={3}>{t("先创建一个项目")}</Title>
				<Text type="secondary" className="gate-lead">
					{t(
						"全链哨兵 的每条命令都在项目专属的 Docker 容器里执行，文件写入该项目的工作目录。没有项目就没有可执行的环境，因此不提供默认目录。",
					)}
				</Text>

				<Form layout="vertical" className="gate-form" onFinish={() => void submit()} disabled={submitting || busy}>
					<Form.Item label={t("项目名称")} required htmlFor="project-gate-name">
					<Input
							id="project-gate-name"
						autoFocus
						value={name}
						placeholder={t("项目名称，如 靶场-01")}
						spellCheck={false}
						disabled={submitting || busy}
						onChange={(event) => setName(event.target.value)}
					/>
					</Form.Item>
					<ProjectProxyFields config={proxyConfig} choice={createProxy} disabled={submitting || busy} onChange={setCreateProxy} />
					<Button
						type="primary"
						icon={<PlusOutlined />}
						loading={submitting || busy}
						disabled={!name.trim()}
						htmlType="submit"
					>
						{t("创建并进入")}
					</Button>
				</Form>

				{error ? <Alert type="error" showIcon title={error} className="ui-page__alert" /> : null}

				<Text type="secondary" className="gate-note">
					{t("需要先构建工具镜像（")}
					<Text code>docker build -t sentinel:latest docker/</Text>
					{t("），否则创建会失败。")}
				</Text>

				{projects.length > 0 ? (
					<div className="gate-projects">
						<Text strong>{t("或进入已有项目")}</Text>
						<List
							size="small"
							dataSource={projects}
							renderItem={(project) => (
								<List.Item
									actions={[
										<Button
											key="open"
											size="small"
											type="link"
											icon={<FolderOpenOutlined />}
											disabled={busy}
											onClick={() => onSwitch(project.id)}
										>
											{t("进入")}
										</Button>,
									]}
								>
									<List.Item.Meta
										title={project.name}
										description={<Text code>{project.cwd}</Text>}
									/>
								</List.Item>
							)}
						/>
					</div>
				) : null}

				<Button type="link" icon={<SettingOutlined />} onClick={onOpenSettings} className="gate-settings">
					{t("先去配置模型端点")}
				</Button>
			</Card>
		</div>
	);
}

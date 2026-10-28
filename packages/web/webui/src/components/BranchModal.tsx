import { Breadcrumb, Button, Collapse, Input, List, Modal, Space, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { t } from "../i18n.ts";
import type { SessionTreeNodeView, SentinelForkPoint } from "../types.ts";

const { Text } = Typography;

interface PathEntry {
	id: string;
	label: string;
}

interface BranchOption {
	entryId: string;
	label: string;
	summary: string;
	messageCount: number;
	active: boolean;
}

interface ForkPoint {
	id: string;
	summary: string;
	timestamp: string;
	branches: BranchOption[];
}

/** Human summary of a tree entry. */
function entrySummary(node: SessionTreeNodeView): string {
	const message = node.entry.message;
	if (node.label) return node.label;
	if (message && Array.isArray(message.content)) {
		const text = (message.content as Array<{ type?: string; text?: string }>)
			.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		if (text) return text.slice(0, 40);
	}
	switch (node.entry.type) {
		case "compaction":
			return t("≡ 压缩点");
		case "branch_summary":
			return t("↩ 分支摘要");
		default:
			return node.entry.type;
	}
}

function countMessages(node: SessionTreeNodeView): number {
	const own = node.entry.type === "message" ? 1 : 0;
	return own + node.children.reduce((sum, child) => sum + countMessages(child), 0);
}

/** Root-to-leaf path as flat summaries; empty when no leaf is known. */
function findPath(tree: SessionTreeNodeView[], leafId: string | null): PathEntry[] {
	if (!leafId) return [];
	const path: PathEntry[] = [];
	const walk = (nodes: SessionTreeNodeView[]): boolean => {
		for (const node of nodes) {
			path.push({ id: node.entry.id, label: entrySummary(node) });
			if (node.entry.id === leafId) return true;
			if (walk(node.children)) return true;
			path.pop();
		}
		return false;
	};
	return walk(tree) ? path : [];
}

/** All branch points (nodes with 2+ children) with their branch options. */
function collectForks(tree: SessionTreeNodeView[], activeIds: Set<string>): ForkPoint[] {
	const forks: ForkPoint[] = [];
	const walk = (node: SessionTreeNodeView): void => {
		if (node.children.length > 1) {
			forks.push({
				id: node.entry.id,
				summary: entrySummary(node),
				timestamp: node.entry.timestamp,
				branches: node.children.map((child) => ({
					entryId: child.entry.id,
					label: child.label ?? "",
					summary: entrySummary(child),
					messageCount: countMessages(child),
					active: activeIds.has(child.entry.id),
				})),
			});
		}
		node.children.forEach(walk);
	};
	tree.forEach(walk);
	return forks;
}

export function BranchModal({
	tree,
	leafId,
	forkPoints,
	onNavigate,
	onRenameBranch,
	onClose,
}: {
	tree: SessionTreeNodeView[];
	leafId: string | null;
	forkPoints: SentinelForkPoint[];
	onNavigate: (entryId: string) => void;
	onRenameBranch: (entryId: string, label: string) => void;
	onClose: () => void;
}) {
	const [expandedFork, setExpandedFork] = useState<string | null>(null);
	const [editingBranch, setEditingBranch] = useState<string | null>(null);
	const [editValue, setEditValue] = useState("");

	const path = useMemo(() => findPath(tree, leafId), [tree, leafId]);
	const activeIds = useMemo(() => new Set(path.map((item) => item.id)), [path]);
	const forks = useMemo(() => collectForks(tree, activeIds), [tree, activeIds]);

	const jump = (entryId: string) => {
		if (entryId === leafId) return;
		onNavigate(entryId);
		onClose();
	};

	return (
		<Modal
			open
			width={780}
			title={t("会话分支")}
			footer={null}
			onCancel={onClose}
			destroyOnHidden
			className="branchhub"
		>
			<Text type="secondary">{t("点击分支立即跳转，原分支完整保留，可随时切回。")}</Text>

			<Breadcrumb
				className="branchhub__crumbs"
				items={
					path.length === 0
						? [{ title: <Text type="secondary">{t("暂无消息")}</Text> }]
						: path.map((item, index) => ({
								title:
									index === path.length - 1 ? (
										<Text strong>{item.label.slice(0, 14) || "…"}</Text>
									) : (
										<Button
											type="link"
											size="small"
											title={item.label}
											onClick={() => jump(item.id)}
										>
											{item.label.slice(0, 14) || "…"}
										</Button>
									),
							}))
				}
			/>

			<Text strong>{t("分叉点 · {count}", { count: forks.length })}</Text>
			{forks.length === 0 ? (
				<Text type="secondary">{t("还没有分叉。在历史消息上点「↩ 从此分叉」即可开新分支。")}</Text>
			) : (
				<Collapse
					className="branchhub__forks"
					items={forks.map((fork) => ({
						key: fork.id,
						label: (
							<Space size={8} wrap>
								<Text>{fork.summary.slice(0, 30)}</Text>
								<Text type="secondary">{t("{count} 条分支", { count: fork.branches.length })}</Text>
							</Space>
						),
						children: (
							<div className="branchhub__branches">
								{fork.branches.map((branch) => (
									<div key={branch.entryId} className="branchhub__branch">
										<Button
											type="link"
											size="small"
											disabled={branch.active}
											title={branch.summary}
											onClick={() => jump(branch.entryId)}
										>
											<Space size={6} wrap>
												<Text>{branch.label || branch.summary.slice(0, 26)}</Text>
												<Text type="secondary">{t("{count} 条", { count: branch.messageCount })}</Text>
												{branch.active ? (
													<Tag color="blue" variant="filled">
														{t("当前")}
													</Tag>
												) : null}
											</Space>
										</Button>
										{editingBranch === branch.entryId ? (
											<Input
												size="small"
												autoFocus
												style={{ width: 160 }}
												value={editValue}
												onChange={(event) => setEditValue(event.target.value)}
												onKeyDown={(event) => {
													if (event.key === "Enter") {
														if (editValue.trim()) onRenameBranch(branch.entryId, editValue.trim());
														setEditingBranch(null);
													}
													if (event.key === "Escape") setEditingBranch(null);
												}}
												onBlur={() => setEditingBranch(null)}
												placeholder={t("分支名称")}
												spellCheck={false}
											/>
										) : (
											<Button
												type="link"
												size="small"
												title={t("命名分支")}
												onClick={() => {
													setEditingBranch(branch.entryId);
													setEditValue(branch.label);
												}}
											>
												{t("命名")}
											</Button>
										)}
									</div>
								))}
							</div>
						),
					}))}
				/>
			)}

			{forkPoints.length > 0 ? (
				<>
					<Text strong>{t("从历史消息分叉")}</Text>
					<List
						size="small"
						dataSource={forkPoints.slice().reverse().slice(0, 8)}
						renderItem={(point) => (
							<List.Item className="branchhub__point" onClick={() => jump(point.entryId)}>
								<Text ellipsis title={point.text}>
									↩ {point.text.slice(0, 40) || t("(空)")}
								</Text>
							</List.Item>
						)}
					/>
				</>
			) : null}
		</Modal>
	);
}

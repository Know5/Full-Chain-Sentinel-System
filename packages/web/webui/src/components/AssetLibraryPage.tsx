/**
 * The asset inventory page.
 *
 * The agent reports what it actually touched; this page is where the operator
 * reads it. Rows are read-only except for the verdict: state, tags, and operator
 * records. Deleting is a selection flow so the dialog can state what goes with
 * the rows. Listing is paginated because it is one screen of a ledger that has
 * no size limit; the export always takes the whole filter, not the page.
 */

import { CopyOutlined, DeleteOutlined, DownloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import type { ProColumns } from "@ant-design/pro-components";
import {
	Alert,
	Button,
	Descriptions,
	Drawer,
	Empty,
	Input,
	Modal,
	Select,
	Space,
	Tag,
	Timeline,
	Tooltip,
	Typography,
} from "antd";
import type { DescriptionsProps } from "antd";
import { useEffect, useState } from "react";
import { t } from "../i18n.ts";
import type {
	SentinelAssetDeletePreview,
	SentinelAssetDetail,
	SentinelAssetEntry,
	SentinelAssetFilters,
	SentinelAssetKind,
	SentinelAssetOutcome,
	SentinelAssetState,
	SentinelAssetStats,
	SentinelAssetSummary,
	SentinelAssetUpdate,
	SentinelVulnSummary,
} from "../types.ts";
import {
	SENTINEL_ASSET_KINDS,
	SENTINEL_ASSET_KIND_LABELS,
	SENTINEL_ASSET_OUTCOMES,
	SENTINEL_ASSET_OUTCOME_LABELS,
	SENTINEL_ASSET_STATES,
	SENTINEL_ASSET_STATE_LABELS,
	SENTINEL_VULN_SEVERITY_LABELS,
} from "../types.ts";
import type { SentinelVulnSeverity } from "../types.ts";
import { Page, Section } from "../ui/Page.tsx";

const { Text } = Typography;

const KIND_COLORS: Record<SentinelAssetKind, string> = {
	domain: "geekblue",
	ip: "cyan",
	service: "purple",
	url: "blue",
};

const STATE_COLORS: Record<SentinelAssetState, string> = {
	pending: "gold",
	testing: "blue",
	tested: "green",
	out_of_scope: "default",
};

const VULN_SEVERITY_COLORS: Record<SentinelVulnSeverity, string> = {
	critical: "red",
	high: "volcano",
	medium: "gold",
	low: "blue",
	info: "default",
};

const OUTCOME_COLORS: Record<SentinelAssetOutcome, string> = {
	note: "default",
	clean: "green",
	suspicious: "orange",
	vulnerable: "red",
	unreachable: "default",
};

function formatWhen(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	const sameYear = date.getFullYear() === new Date().getFullYear();
	const datePart = sameYear
		? `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
		: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	return `${datePart} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function stateLabel(state: SentinelAssetState): string {
	return SENTINEL_ASSET_STATE_LABELS[state];
}

function kindLabel(kind: SentinelAssetKind): string {
	return SENTINEL_ASSET_KIND_LABELS[kind];
}

function outcomeLabel(outcome: SentinelAssetOutcome | undefined): string {
	return outcome ? SENTINEL_ASSET_OUTCOME_LABELS[outcome] : t("无结论");
}

function testSummary(item: SentinelAssetSummary): string {
	if (item.testCount === 0) return "—";
	return `${item.testCount} · ${outcomeLabel(item.lastOutcome)}`;
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			type="text"
			size="small"
			icon={<CopyOutlined />}
			title={t("复制")}
			onClick={() => {
				void navigator.clipboard
					.writeText(text)
					.then(() => {
						setCopied(true);
						window.setTimeout(() => setCopied(false), 1200);
					})
					.catch(() => {});
			}}
		>
			{copied ? t("已复制") : t("复制")}
		</Button>
	);
}

/** One timeline entry; status changes are quieter than test records. */
function entryAuthor(entry: SentinelAssetEntry): string {
	return entry.author === "operator" ? t("操作员") : (entry.source ?? t("代理"));
}

function VulnLinks({ vulns, onOpenVuln }: { vulns: SentinelVulnSummary[]; onOpenVuln: (id: string) => void }) {
	if (vulns.length === 0) return <Text type="secondary">{t("没有关联的漏洞记录")}</Text>;
	return (
		<Space orientation="vertical" size={4}>
			{vulns.map((vuln) => (
				<Button key={vuln.id} type="link" size="small" onClick={() => onOpenVuln(vuln.id)}>
					<Text code>{vuln.label}</Text>
					<Tag
						color={VULN_SEVERITY_COLORS[vuln.severity]}
						variant="filled"
						style={{ marginInlineStart: 8 }}
					>
						{SENTINEL_VULN_SEVERITY_LABELS[vuln.severity]}
					</Tag>
					{vuln.title}
				</Button>
			))}
		</Space>
	);
}

/** The detail content, exported so it can be rendered without the drawer. */
export function AssetDetailBody({
	detail,
	onClose,
	onUpdate,
	onRequestDelete,
	onOpenVuln,
}: {
	detail: SentinelAssetDetail;
	onClose: () => void;
	onUpdate: (id: string, patch: SentinelAssetUpdate) => void;
	onRequestDelete: (ids: string[]) => void;
	onOpenVuln: (id: string) => void;
}) {
	const asset = detail.asset;
	const [tags, setTags] = useState(asset.tags.join(", "));
	const [outcome, setOutcome] = useState<SentinelAssetOutcome>("note");
	const [note, setNote] = useState("");

	useEffect(() => {
		setTags(asset.tags.join(", "));
	}, [asset.id, asset.tags]);

	useEffect(() => {
		setOutcome("note");
		setNote("");
	}, [asset.id]);

	const saveTags = () => {
		const next = tags
			.split(/[,，]/)
			.map((item) => item.trim())
			.filter(Boolean);
		onUpdate(asset.id, { tags: next });
	};

	const addRecord = () => {
		if (note.trim() === "" && outcome === "note") return;
		onUpdate(asset.id, { outcome, ...(note.trim() ? { note } : {}) });
		setNote("");
	};

	const inconsistent = asset.lastOutcome === "vulnerable" && detail.vulns.length === 0;

	const metaItems: DescriptionsProps["items"] = [
		{ key: "kind", label: t("类型"), children: kindLabel(asset.kind) },
		{ key: "state", label: t("状态"), children: stateLabel(asset.status) },
		{ key: "domain", label: t("域名"), children: asset.domain ?? "—" },
		{ key: "ip", label: t("IP"), children: asset.ip ?? "—" },
		{
			key: "port",
			label: t("端口"),
			children:
				asset.port === undefined ? "—" : `${asset.port}${asset.transport ? `/${asset.transport}` : ""}`,
		},
		{ key: "protocol", label: t("协议"), children: asset.protocol ?? "—" },
		{ key: "url", label: t("URL"), children: asset.url ? <Text code>{asset.url}</Text> : "—" },
		{ key: "title", label: t("标题"), children: asset.title ?? "—" },
		{ key: "server", label: t("服务"), children: asset.server ?? "—" },
		{ key: "tech", label: t("技术栈"), children: asset.tech ?? "—" },
		{ key: "source", label: t("来源"), children: asset.source },
		{ key: "session", label: t("会话"), children: asset.sessionName ?? "—" },
		{ key: "first", label: t("首次发现"), children: formatWhen(asset.firstSeenAt) },
		{ key: "last", label: t("最近发现"), children: formatWhen(asset.lastSeenAt) },
		{ key: "tests", label: t("测试记录"), children: asset.testCount },
	];

	return (
		<div className="assethub-detail">
			<div className="assethub-detail__head">
				<div className="assethub-detail__title">
					<Text strong className="assethub-detail__name">
						{asset.label} · {asset.name}
					</Text>
					<Space size={6} wrap>
						<Tag color={KIND_COLORS[asset.kind]} variant="filled">
							{kindLabel(asset.kind)}
						</Tag>
						<Tag color={STATE_COLORS[asset.status]} variant="filled">
							{stateLabel(asset.status)}
						</Tag>
						{asset.tags.map((tag) => (
							<Tag key={tag} variant="filled">
								{tag}
							</Tag>
						))}
					</Space>
				</div>
				<Space size={4}>
					<CopyButton text={asset.url ?? asset.name} />
					<Button danger size="small" icon={<DeleteOutlined />} onClick={() => onRequestDelete([asset.id])}>
						{t("删除")}
					</Button>
				</Space>
			</div>

			<Descriptions size="small" column={2} bordered items={metaItems} className="assethub-detail__desc" />

			{inconsistent ? (
				<Alert
					type="warning"
					showIcon
					className="ui-page__alert"
					title={t("最近一次测试结论为「有漏洞」，但没有关联的漏洞中枢记录；核实后用 vuln_submit 补交。")}
				/>
			) : null}

			<div className="assethub-controls">
				<Text type="secondary">{t("状态")}</Text>
				<Select
					size="small"
					value={asset.status}
					style={{ width: 120 }}
					onChange={(value) => onUpdate(asset.id, { status: value as SentinelAssetState })}
					options={SENTINEL_ASSET_STATES.map((state) => ({ value: state, label: stateLabel(state) }))}
				/>
				<Text type="secondary">{t("标签")}</Text>
				<Input
					size="small"
					className="assethub-tags-input"
					value={tags}
					placeholder={t("用逗号分隔，如 OA, 后台")}
					spellCheck={false}
					onChange={(event) => setTags(event.target.value)}
					onPressEnter={saveTags}
				/>
				<Button size="small" onClick={saveTags}>
					{t("保存标签")}
				</Button>
			</div>

			<div className="assethub-record">
				<Select
					size="small"
					value={outcome}
					style={{ width: 110 }}
					onChange={(value) => setOutcome(value as SentinelAssetOutcome)}
					options={SENTINEL_ASSET_OUTCOMES.map((item) => ({
						value: item,
						label: SENTINEL_ASSET_OUTCOME_LABELS[item],
					}))}
				/>
				<Input.TextArea
					value={note}
					placeholder={t("操作员记录：复核结论、备注或证据出处")}
					autoSize={{ minRows: 2, maxRows: 5 }}
					onChange={(event) => setNote(event.target.value)}
				/>
				<Button
					type="primary"
					disabled={note.trim() === "" && outcome === "note"}
					onClick={addRecord}
				>
					{t("添加记录")}
				</Button>
			</div>

			<Section title={t("时间线")}>
				{asset.entries.length === 0 ? (
					<Text type="secondary">
						{t("还没有测试记录：Agent 用 asset_note 记录，操作员也可以在上方添加。")}
					</Text>
				) : (
					<Timeline
						items={asset.entries.map((entry) => ({
							key: entry.seq,
							color: entry.kind === "status" ? "gray" : OUTCOME_COLORS[entry.outcome],
							children: (
								<div className="assethub-entry">
									<div className="assethub-entry__head">
										<Text type="secondary" className="assethub-entry__at">
											{formatWhen(entry.at)}
										</Text>
										<Text>{entryAuthor(entry)}</Text>
										<Tag color={OUTCOME_COLORS[entry.outcome]} variant="filled">
											{entry.kind === "status" ? t("状态") : SENTINEL_ASSET_OUTCOME_LABELS[entry.outcome]}
										</Tag>
										{entry.method ? <Text code>{entry.method}</Text> : null}
										{entry.vulnLabel ? <Tag variant="filled">{entry.vulnLabel}</Tag> : null}
									</div>
									{entry.text.trim() ? <div className="assethub-entry__text">{entry.text}</div> : null}
								</div>
							),
						}))}
					/>
				)}
			</Section>

			<Section title={t("关联漏洞")}>
				<VulnLinks vulns={detail.vulns} onOpenVuln={onOpenVuln} />
			</Section>
		</div>
	);
}

export function AssetDetail(props: Parameters<typeof AssetDetailBody>[0]) {
	return (
		<Drawer
			open
			width={720}
			onClose={props.onClose}
			destroyOnHidden
			className="assethub-drawer"
			title={t("资产详情")}
		>
			<AssetDetailBody {...props} />
		</Drawer>
	);
}

/** The delete confirmation's content, exported so it can be rendered on its own. */
export function AssetDeleteBody({
	pending,
	preview,
}: {
	pending: string[] | null;
	preview: SentinelAssetDeletePreview | null;
}) {
	return (
		<div className="assethub-delete">
			<Text>{t("将删除 {count} 条资产。", { count: preview?.count ?? pending?.length ?? 0 })}</Text>
			{preview ? (
				<ul>
					<li>{t("{count} 条时间线记录", { count: preview.records })}</li>
					<li>{t("{count} 条漏洞的关联会被解除（漏洞本身保留）", { count: preview.vulns })}</li>
				</ul>
			) : (
				<Text type="secondary">{t("正在统计影响…")}</Text>
			)}
			<Text type="secondary">{t("资产、时间线与导出内容都会消失；关联漏洞只解除关联，不删除漏洞记录。")}</Text>
		</div>
	);
}

export function AssetLibraryPage({
	items,
	stats,
	total,
	page,
	pageSize,
	filters,
	detail,
	deletePending,
	deletePreview,
	projectName,
	hasProject,
	onQuery,
	onOpen,
	onCloseDetail,
	onUpdate,
	onRequestDelete,
	onConfirmDelete,
	onCancelDelete,
	onExport,
	onOpenVuln,
}: {
	items: SentinelAssetSummary[];
	stats: SentinelAssetStats;
	total: number;
	page: number;
	pageSize: number;
	hasMore: boolean;
	filters: SentinelAssetFilters;
	detail: SentinelAssetDetail | null;
	deletePending: string[] | null;
	deletePreview: SentinelAssetDeletePreview | null;
	projectName: string | null;
	hasProject: boolean;
	onQuery: (filters: SentinelAssetFilters, page: number, pageSize: number) => void;
	onOpen: (id: string) => void;
	onCloseDetail: () => void;
	onUpdate: (id: string, patch: SentinelAssetUpdate) => void;
	onRequestDelete: (ids: string[]) => void;
	onConfirmDelete: (ids: string[]) => void;
	onCancelDelete: () => void;
	onExport: (filters: SentinelAssetFilters) => void;
	onOpenVuln: (id: string) => void;
}) {
	const [search, setSearch] = useState(filters.search ?? "");
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

	useEffect(() => {
		setSearch(filters.search ?? "");
	}, [filters.search]);

	// A page/filter change starts a new selection; a live refresh only drops ids
	// that no longer exist.
	useEffect(() => {
		setSelected(new Set());
	}, [page, pageSize, filters]);

	useEffect(() => {
		setSelected((prev) => {
			if (prev.size === 0) return prev;
			const alive = new Set(items.map((item) => item.id));
			const next = new Set([...prev].filter((id) => alive.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [items]);

	const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
	const selectedIds = items.filter((item) => selected.has(item.id)).map((item) => item.id);

	const changeFilters = (patch: Partial<SentinelAssetFilters>) => {
		onQuery({ ...filters, ...patch }, 1, pageSize);
	};

	const reset = () => {
		setSearch("");
		onQuery({}, 1, pageSize);
	};

	if (!hasProject) {
		return (
			<Page title={t("资产库")} description={t("资产库按项目隔离")}>
				<Empty
					image={Empty.PRESENTED_IMAGE_SIMPLE}
					description={
						<>
							<div>{t("尚未选择项目")}</div>
							<div className="assethub-empty-hint">{t("请先在侧栏顶部选择或创建一个项目")}</div>
						</>
					}
				/>
			</Page>
		);
	}

	const columns: ProColumns<SentinelAssetSummary>[] = [
		{
			title: t("编号"),
			dataIndex: "label",
			key: "label",
			width: 108,
			render: (_, item) => <Text className="table-mono">{item.label}</Text>,
		},
		{
			title: t("类型"),
			dataIndex: "kind",
			key: "kind",
			width: 84,
			render: (_, item) => (
				<Tag color={KIND_COLORS[item.kind]} variant="filled">
					{kindLabel(item.kind)}
				</Tag>
			),
		},
		{
			title: t("资产"),
			dataIndex: "name",
			key: "name",
			ellipsis: { showTitle: true },
			render: (_, item) => (
				<div className="assethub-name">
					<Text className="table-mono" title={item.name}>
						{item.name}
					</Text>
					{item.title ? <Text type="secondary">{item.title}</Text> : null}
				</div>
			),
		},
		{
			title: t("协议"),
			dataIndex: "protocol",
			key: "protocol",
			width: 88,
			render: (_, item) => item.protocol ?? <Text type="secondary">—</Text>,
		},
		{
			title: t("状态"),
			dataIndex: "status",
			key: "status",
			width: 96,
			render: (_, item) => (
				<Tag color={STATE_COLORS[item.status]} variant="filled">
					{stateLabel(item.status)}
				</Tag>
			),
		},
		{
			title: t("测试"),
			key: "tests",
			width: 150,
			render: (_, item) => <Text type="secondary">{testSummary(item)}</Text>,
		},
		{
			title: t("最近发现"),
			dataIndex: "lastSeenAt",
			key: "lastSeenAt",
			width: 118,
			render: (_, item) => <Text type="secondary">{formatWhen(item.lastSeenAt)}</Text>,
		},
		{
			title: t("来源"),
			dataIndex: "source",
			key: "source",
			width: 150,
			ellipsis: { showTitle: true },
			render: (_, item) => <Text type="secondary">{item.source}</Text>,
		},
	];

	return (
		<Page
			title={t("资产库")}
			description={
				<>
					{projectName ? `${projectName} · ` : ""}
					{t("共 {total} 条 · 待测试 {pending}", { total: stats.total, pending: stats.byStatus.pending })}
					{filters.search || filters.kind || filters.status || filters.tested !== undefined
						? ` · ${t("筛选命中 {count} 条", { count: total })}`
						: ""}
				</>
			}
			extra={
				<Button type="primary" icon={<DownloadOutlined />} onClick={() => onExport(filters)}>
					{t("导出 Markdown")}
				</Button>
			}
		>
			<div className="assethub-stats">
				{SENTINEL_ASSET_KINDS.map((kind) => (
					<Tag key={kind} color={KIND_COLORS[kind]} variant="filled">
						{kindLabel(kind)} {stats.byKind[kind]}
					</Tag>
				))}
				{SENTINEL_ASSET_STATES.map((state) => (
					<Tag key={state} color={STATE_COLORS[state]} variant="filled">
						{stateLabel(state)} {stats.byStatus[state]}
					</Tag>
				))}
			</div>

			{selectedIds.length > 0 ? (
				<Alert
					type="info"
					showIcon
					className="ui-page__alert"
					title={t("已选择 {count} 条", { count: selectedIds.length })}
					action={
						<Space size={8}>
							<Button size="small" onClick={() => setSelected(new Set())}>
								{t("取消选择")}
							</Button>
							<Button size="small" danger icon={<DeleteOutlined />} onClick={() => onRequestDelete(selectedIds)}>
								{t("删除选中")}
							</Button>
						</Space>
					}
				/>
			) : null}

			<ProTable<SentinelAssetSummary>
				rowKey="id"
				size="small"
				columns={columns}
				dataSource={items}
				search={false}
				options={false}
				scroll={{ x: 980 }}
				rowSelection={{
					selectedRowKeys: selectedIds,
					onChange: (keys) => setSelected(new Set(keys as string[])),
					columnWidth: 44,
				}}
				pagination={{
					current: Math.max(1, page),
					pageSize,
					total,
					showSizeChanger: true,
					pageSizeOptions: [20, 50, 100, 200],
					showTotal: (count) => t("共 {total} 条", { total: count }),
					onChange: (next, size) => onQuery(filters, size !== pageSize ? 1 : next, size),
				}}
				toolbar={{
					title: (
						<div className="assethub-toolbar">
							<Input
								allowClear
								className="assethub-toolbar__search"
								prefix={<SearchOutlined />}
								value={search}
								placeholder={t("搜索编号 / 名称 / URL / 标题 / 标签 / 来源")}
								onChange={(event) => setSearch(event.target.value)}
								onPressEnter={() => changeFilters({ search: search.trim() || undefined })}
							/>
							<Select
								value={filters.kind ?? ""}
								style={{ width: 116 }}
								onChange={(value) =>
									changeFilters({ kind: (value || undefined) as SentinelAssetKind | undefined })
								}
								options={[
									{ value: "", label: t("全部类型") },
									...SENTINEL_ASSET_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) })),
								]}
							/>
							<Select
								value={filters.status ?? ""}
								style={{ width: 116 }}
								onChange={(value) =>
									changeFilters({ status: (value || undefined) as SentinelAssetState | undefined })
								}
								options={[
									{ value: "", label: t("全部状态") },
									...SENTINEL_ASSET_STATES.map((state) => ({ value: state, label: stateLabel(state) })),
								]}
							/>
							<Select
								value={filters.tested === undefined ? "" : filters.tested ? "yes" : "no"}
								style={{ width: 116 }}
								onChange={(value) =>
									changeFilters({ tested: value === "" ? undefined : value === "yes" })
								}
								options={[
									{ value: "", label: t("全部结论") },
									{ value: "yes", label: t("有结论") },
									{ value: "no", label: t("无结论") },
								]}
							/>
							<Button type="link" onClick={reset}>
								{t("重置")}
							</Button>
							<Button
								type="link"
								disabled={items.length === 0}
								title={t("只选中当前页，不含其他页")}
								onClick={() =>
									setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
								}
							>
								{allSelected ? t("取消全选") : t("全选本页")}
							</Button>
						</div>
					),
				}}
				onRow={(record) => ({
					onClick: (event) => {
						const target = event.target as HTMLElement;
						if (target.closest("button, a, .ant-checkbox-wrapper, .ant-table-selection-column")) return;
						onOpen(record.id);
					},
					style: { cursor: "pointer" },
				})}
				locale={{
					emptyText: (
						<Empty
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={
								<>
									<div>{stats.total === 0 ? t("还没有资产记录") : t("没有符合条件的资产")}</div>
									<div className="assethub-empty-hint">
										{stats.total === 0
											? t("Agent 在探测目标时用 asset_report 上报；需要在「设置 → 权限」开启 asset_library_write")
											: t("调整搜索或筛选条件")}
									</div>
								</>
							}
						/>
					),
				}}
			/>

			{detail ? (
				<AssetDetail
					detail={detail}
					onClose={onCloseDetail}
					onUpdate={onUpdate}
					onRequestDelete={onRequestDelete}
					onOpenVuln={onOpenVuln}
				/>
			) : null}

			<Modal
				open={deletePending !== null}
				title={t("删除资产")}
				okText={t("确认删除")}
				cancelText={t("取消")}
				okButtonProps={{ danger: true, disabled: deletePreview === null }}
				onOk={() => {
					if (deletePending) onConfirmDelete(deletePending);
				}}
				onCancel={onCancelDelete}
				destroyOnHidden
			>
				<AssetDeleteBody pending={deletePending} preview={deletePreview} />
			</Modal>
		</Page>
	);
}

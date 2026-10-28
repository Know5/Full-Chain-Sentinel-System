/**
 * The POC library page: the operator's Nuclei template center.
 *
 * The library is a ledger: the filters are one row, the table is the page, and
 * a template's yaml opens inside its own row instead of in a modal. That keeps
 * the reader in the list while inspecting a template.
 *
 * Import and the one-click official sync are the only write actions here, and
 * both belong to the operator. The agent never gets an import or delete tool —
 * its whole interface to the library is poc_search / poc_read, and the
 * templates themselves are never mounted into a project container. To fire a
 * template, the agent writes its own yaml into the working directory and runs
 * nuclei on that.
 */

import { CopyOutlined, DeleteOutlined, DownloadOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import { Alert, Button, Input, Popconfirm, Select, Space, Tag, Tooltip, Typography } from "antd";
import type { ProColumns } from "@ant-design/pro-components";
import { useRef, useState } from "react";
import { t } from "../i18n.ts";
import type {
	SentinelPoc,
	SentinelPocFilters,
	SentinelPocImportOutcome,
	SentinelPocImportProgress,
	SentinelPocSeverity,
	SentinelPocSource,
	SentinelPocStats,
	SentinelPocSummary,
} from "../types.ts";
import { SENTINEL_VULN_SEVERITIES, SENTINEL_VULN_SEVERITY_LABELS } from "../types.ts";
import { Page } from "../ui/Page.tsx";

const { Text } = Typography;

const SEVERITY_COLORS: Record<SentinelPocSeverity, string> = {
	critical: "red",
	high: "volcano",
	medium: "gold",
	low: "blue",
	info: "default",
};

function shortWhen(value: string): string {
	return value.slice(0, 16).replace("T", " ");
}

/** The official source's newest outcome as one dim line; failures say why. */
function officialLine(source: SentinelPocSource): string {
	const last = source.lastResult;
	if (!last) return t("官方同步：还没有同步过");
	const when = last.at.slice(0, 19).replace("T", " ");
	const base = t("{when} · 新增 {imported} · 覆盖 {replaced} · 跳过 {skipped} · {duration}s", {
		when,
		imported: last.imported,
		replaced: last.replaced,
		skipped: last.skipped,
		duration: (last.durationMs / 1000).toFixed(1),
	});
	return last.ok
		? t("官方同步：{base}", { base })
		: t("官方同步失败：{base} · {error}", { base, error: last.error ?? t("未知错误") });
}

export function PocPage({
	items,
	stats,
	page,
	pageSize,
	total,
	filters,
	detail,
	importing,
	importProgress,
	outcome,
	onFiltersChange,
	onPageChange,
	onOpen,
	onImport,
	onDelete,
	officialSource,
	officialSyncing,
	onSyncOfficial,
}: {
	items: SentinelPocSummary[];
	stats: SentinelPocStats;
	/** The page this table shows, 1-based, with the page size the server used. */
	page: number;
	pageSize: number;
	/** Matches across all pages under the current filter. */
	total: number;
	filters: SentinelPocFilters;
	detail: SentinelPoc | null;
	importing: boolean;
	/** Live counters while the HTTP import job runs. */
	importProgress: SentinelPocImportProgress | null;
	/** Result of the last import batch, shown until the next one starts. */
	outcome: SentinelPocImportOutcome | null;
	onFiltersChange(filters: SentinelPocFilters): void;
	/** Turn to another page of the current filter. */
	onPageChange(page: number): void;
	/** Fetch one template's full yaml for the row being expanded. */
	onOpen(id: string): void;
	onImport(files: File[]): void;
	onDelete(id: string): void;
	/** The built-in official source, once the one-click sync created it. */
	officialSource: SentinelPocSource | null;
	/** True while that sync downloads and imports; it can take minutes. */
	officialSyncing: boolean;
	onSyncOfficial(): void;
}) {
	const [search, setSearch] = useState(filters.search ?? "");
	const [tag, setTag] = useState(filters.tag ?? "");
	const [openId, setOpenId] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement | null>(null);

	const apply = (patch: SentinelPocFilters): void => {
		onFiltersChange({
			...(search.trim() ? { search: search.trim() } : {}),
			...(filters.severity ? { severity: filters.severity } : {}),
			...(tag.trim() ? { tag: tag.trim() } : {}),
			...patch,
		});
	};

	/** Open a row: the yaml arrives asynchronously, so the row says it is loading. */
	const toggleRow = (id: string): void => {
		if (openId === id) {
			setOpenId(null);
			return;
		}
		setOpenId(id);
		onOpen(id);
	};

	const columns: ProColumns<SentinelPocSummary>[] = [
		{
			title: t("模板 ID"),
			dataIndex: "id",
			key: "id",
			width: 200,
			ellipsis: { showTitle: true },
			sorter: (left, right) => left.id.localeCompare(right.id),
			render: (_, item) => <Text code>{item.id}</Text>,
		},
		{
			title: t("等级"),
			dataIndex: "severity",
			key: "severity",
			width: 90,
			render: (_, item) => (
				<Tag color={SEVERITY_COLORS[item.severity]} variant="filled">
					{SENTINEL_VULN_SEVERITY_LABELS[item.severity]}
				</Tag>
			),
		},
		{
			title: t("名称"),
			dataIndex: "name",
			key: "name",
			ellipsis: { showTitle: true },
		},
		{
			title: t("标签"),
			dataIndex: "tags",
			key: "tags",
			width: 220,
			render: (_, item) => (
				<Space size={4} wrap>
					{item.tags.slice(0, 3).map((value) => (
						<Tag key={value} variant="filled">
							{value}
						</Tag>
					))}
					{item.tags.length > 3 ? (
						<Tooltip title={item.tags.join(", ")}>
							<Tag variant="filled">+{item.tags.length - 3}</Tag>
						</Tooltip>
					) : null}
				</Space>
			),
		},
		{
			title: "CVE",
			dataIndex: "references",
			key: "references",
			width: 160,
			ellipsis: true,
			render: (_, item) => item.references.join(", ") || <Text type="secondary">—</Text>,
		},
		{
			title: t("导入时间"),
			dataIndex: "importedAt",
			key: "importedAt",
			width: 150,
			sorter: (left, right) => left.importedAt.localeCompare(right.importedAt),
			render: (_, item) => <Text type="secondary">{shortWhen(item.importedAt)}</Text>,
		},
		{
			title: t("操作"),
			key: "actions",
			width: 64,
			render: (_, item) => (
				<Popconfirm
					title={t("删除模板")}
					description={t("删除「{id}」？该操作不可恢复。", { id: item.id })}
					okText={t("删除")}
					okButtonProps={{ danger: true }}
					cancelText={t("取消")}
					onConfirm={() => {
						if (openId === item.id) setOpenId(null);
						onDelete(item.id);
					}}
				>
					<Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={t("删除模板")} />
				</Popconfirm>
			),
		},
	];

	const totalLine = t("严重 {critical} · 高危 {high} · 中危 {medium} · 低危 {low} · 信息 {info}", {
		critical: stats.bySeverity.critical,
		high: stats.bySeverity.high,
		medium: stats.bySeverity.medium,
		low: stats.bySeverity.low,
		info: stats.bySeverity.info,
	});

	const toolbarFilters = [
		<Input
			key="search"
			allowClear
			className="poc-filters__search"
			prefix={<SearchOutlined />}
			placeholder={t("搜索模板 id、名称、标签或 CVE…")}
			value={search}
			onChange={(event) => setSearch(event.target.value)}
			onPressEnter={() => apply({})}
		/>,
		<Select
			key="severity"
			className="poc-filters__severity"
			value={filters.severity ?? ""}
			onChange={(value) => apply({ severity: (value || undefined) as SentinelPocSeverity | undefined })}
			options={[
				{ value: "", label: t("全部等级") },
				...SENTINEL_VULN_SEVERITIES.map((severity) => ({
					value: severity,
					label: SENTINEL_VULN_SEVERITY_LABELS[severity],
				})),
			]}
		/>,
		<Input
			key="tag"
			allowClear
			className="poc-filters__tag"
			placeholder={t("精确标签，如 cve")}
			value={tag}
			onChange={(event) => setTag(event.target.value)}
			onPressEnter={() => apply({})}
		/>,
		<Button key="query" onClick={() => apply({})}>
			{t("查询")}
		</Button>,
	];

	return (
		<Page
			className="poc-library"
			title={t("POC 库")}
			description={
				filters.search || filters.severity || filters.tag
					? t("共 {total} 个模板 · 当前匹配 {matched} 条 · Agent 侧只读（poc_search / poc_read）", {
							total: stats.total,
							matched: total,
						})
					: t("共 {total} 个模板 · Agent 侧只读（poc_search / poc_read）", { total: stats.total })
			}
			extra={
				<>
					<input
						ref={fileInput}
						type="file"
						multiple
						accept=".yaml,.yml,.zip"
						style={{ display: "none" }}
						onChange={(event) => {
							if (event.target.files && event.target.files.length > 0) onImport([...event.target.files]);
							event.target.value = "";
						}}
					/>
					<Button
						icon={<DownloadOutlined />}
						loading={officialSyncing}
						onClick={onSyncOfficial}
						title={t(
							"从官方仓库 projectdiscovery/nuclei-templates 下载最新模板包（zip 约 18MB、约 1.4 万个模板），按 id 去重后并入 POC 库；不会删除已有模板",
						)}
					>
						{officialSyncing ? t("同步中…") : t("一键同步官方 POC")}
					</Button>
					<Button
						type="primary"
						icon={<UploadOutlined />}
						loading={importing}
						onClick={() => fileInput.current?.click()}
						title={t("选择或拖入 Nuclei 模板文件：可多选 .yaml / .yml，或打包的 .zip（解包后自动跳过非模板文件）")}
					>
						{importing ? t("导入中…") : t("导入 POC")}
					</Button>
				</>
			}
		>
			{officialSource?.lastResult ? (
				<Alert
					type={officialSource.lastResult.ok ? "info" : "error"}
					showIcon
					closable
					className="ui-page__alert"
					title={officialLine(officialSource)}
				/>
			) : null}

			{importing && importProgress ? (
				<Alert
					type="info"
					showIcon
					className="ui-page__alert"
					title={t("已处理 {processed} 条 · 新增 {imported} · 覆盖 {replaced} · 跳过 {skipped}", {
						processed: importProgress.processed,
						imported: importProgress.imported,
						replaced: importProgress.replaced,
						skipped: importProgress.skipped,
					})}
					description={importProgress.current ?? undefined}
				/>
			) : null}

			{outcome ? (
				<Alert
					type="success"
					showIcon
					closable
					className="ui-page__alert"
					title={t("导入完成：新增 {imported} 条，覆盖 {replaced} 条", {
						imported: outcome.imported,
						replaced: outcome.replaced,
					})}
					description={
						outcome.skipped.length > 0
							? t("跳过 {count} 条（{items}）", {
									count: outcome.skipped.length,
									items: `${outcome.skipped
										.slice(0, 3)
										.map((item) => t("{name}：{reason}", { name: item.name, reason: item.reason }))
										.join(t("；"))}${outcome.skipped.length > 3 ? ` ${t("等")}` : ""}`,
								})
							: undefined
					}
				/>
			) : null}

			<ProTable<SentinelPocSummary>
				className="poc-ledger"
				rowKey="id"
				size="small"
				columns={columns}
				dataSource={items}
				search={false}
				toolbar={{ title: <Space size={8}>{toolbarFilters}</Space> }}
				options={{ density: true, setting: true, fullScreen: true, reload: false }}
				pagination={{
					current: Math.max(1, page),
					pageSize,
					total,
					showSizeChanger: false,
					showTotal: (count, range) =>
						t("第 {from}-{to} 条 / 共 {total} 条", { from: range[0], to: range[1], total: count }),
					onChange: (next) => onPageChange(next),
				}}
				scroll={{ x: 1080 }}
				expandable={{
					expandedRowKeys: openId ? [openId] : [],
					onExpandedRowsChange: (keys) => {
						const key = keys[0];
						if (key === undefined) setOpenId(null);
					},
					onExpand: (expanded, record) => {
						if (expanded) {
							setOpenId(record.id);
							onOpen(record.id);
						}
					},
					expandRowByClick: true,
					expandedRowRender: (record) => {
						const loaded = detail?.id === record.id ? detail : null;
						return (
							<div className="poc-yaml">
								<div className="poc-yaml__head">
									<Text type="secondary" className="poc-yaml__meta">
										{record.sourceFile} · {t("导入")} {shortWhen(record.importedAt)}
										{record.tags.length > 0 ? ` · ${record.tags.join(", ")}` : ""}
									</Text>
									<Space size={4}>
										<Button
											size="small"
											type="text"
											icon={<CopyOutlined />}
											disabled={!loaded}
											onClick={() => {
												if (loaded) void navigator.clipboard.writeText(loaded.content).catch(() => {});
											}}
										>
											{t("复制全文")}
										</Button>
										<Popconfirm
											title={t("删除模板")}
											description={t("删除「{id}」？该操作不可恢复。", { id: record.id })}
											okText={t("删除")}
											okButtonProps={{ danger: true }}
											cancelText={t("取消")}
											onConfirm={() => {
												setOpenId(null);
												onDelete(record.id);
											}}
										>
											<Button size="small" type="text" danger icon={<DeleteOutlined />}>
												{t("删除模板")}
											</Button>
										</Popconfirm>
									</Space>
								</div>
								<pre className="poc-yaml__code">{loaded ? loaded.content : t("加载模板全文…")}</pre>
							</div>
						);
					},
				}}
				locale={{
					emptyText: t(
						"暂无模板。点右上「导入 POC」上传 nuclei 模板（可多选 yaml 或 zip）；导入后 Agent 可用 poc_search / poc_read 只读检索。",
					),
				}}
			/>

			<div className="poc-summary">
				<Text type="secondary">
					{t("库为全局共享；模板不进容器，Agent 需自己写 yaml 后经 bash 执行 nuclei")}
				</Text>
				<Text type="secondary">{totalLine}</Text>
			</div>
		</Page>
	);
}

/** Read a picked file as base64; shared with the plugin-package picker. */
export function readFileBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? "");
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

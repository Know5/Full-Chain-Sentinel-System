/**
 * The asset inventory page.
 *
 * The agent reports what it actually touched; this page is where the operator
 * reads it. Rows are read-only except for the verdict: state, tags, and operator
 * records. Deleting is a selection flow so the dialog can state what goes with
 * the rows. Listing is paginated because it is one screen of a ledger that has
 * no size limit; the export always takes the whole filter, not the page.
 */

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
import { DeleteIcon, DownloadIcon } from "./icons.tsx";
import { Overlay } from "./Overlay.tsx";

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
		<button
			type="button"
			className="ghost small"
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
		</button>
	);
}

function Meta({ label, value }: { label: string; value?: string | number | null }) {
	if (value === undefined || value === null || value === "") return null;
	return (
		<div>
			<span>{label}</span>
			<code>{String(value)}</code>
		</div>
	);
}

/** One timeline entry; status changes are quieter than test records. */
function EntryRow({ entry }: { entry: SentinelAssetEntry }) {
	const author = entry.author === "operator" ? t("操作员") : (entry.source ?? t("代理"));
	const outcome =
		entry.kind === "status" ? t("状态") : SENTINEL_ASSET_OUTCOME_LABELS[entry.outcome];
	return (
		<li className={entry.kind === "status" ? "asset-lib-entry is-status" : "asset-lib-entry"}>
			<div className="asset-lib-entry__head">
				<span className="asset-lib-entry__at">{formatWhen(entry.at)}</span>
				<span className="asset-lib-entry__author">{author}</span>
				<span className={`asset-lib-outcome asset-lib-outcome-${entry.outcome}`}>{outcome}</span>
				{entry.method ? <code className="asset-lib-entry__method">{entry.method}</code> : null}
				{entry.vulnLabel ? <span className="asset-lib-entry__vuln">{entry.vulnLabel}</span> : null}
			</div>
			{entry.text.trim() ? <div className="asset-lib-entry__text">{entry.text}</div> : null}
		</li>
	);
}

function VulnLinks({
	vulns,
	onOpenVuln,
}: {
	vulns: SentinelVulnSummary[];
	onOpenVuln: (id: string) => void;
}) {
	if (vulns.length === 0) return <span className="ws-panel__hint">{t("没有关联的漏洞记录")}</span>;
	return (
		<ul className="asset-lib-vulns">
			{vulns.map((vuln) => (
				<li key={vuln.id}>
					<button type="button" className="link" onClick={() => onOpenVuln(vuln.id)}>
						{vuln.label}
					</button>
					<span className={`vuln-sev vuln-sev-${vuln.severity}`}>{SENTINEL_VULN_SEVERITY_LABELS[vuln.severity]}</span>
					<span>{vuln.title}</span>
				</li>
			))}
		</ul>
	);
}

/** The detail drawer: fields, operator controls, timeline and linked findings. */
export function AssetDetail({
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

	return (
		<Overlay
			title={`${asset.label} · ${asset.name}`}
			subtitle={`${kindLabel(asset.kind)} · ${stateLabel(asset.status)}`}
			onClose={onClose}
			className="asset-lib-detail"
			actions={
				<>
					<CopyButton text={asset.url ?? asset.name} />
					<button type="button" className="danger" onClick={() => onRequestDelete([asset.id])}>
						<DeleteIcon />
						{t("删除")}
					</button>
				</>
			}
		>
			<div className="asset-lib-meta">
				<Meta label={t("类型")} value={kindLabel(asset.kind)} />
				<Meta label={t("状态")} value={stateLabel(asset.status)} />
				<Meta label={t("域名")} value={asset.domain} />
				<Meta label={t("IP")} value={asset.ip} />
				<Meta
					label={t("端口")}
					value={asset.port === undefined ? undefined : `${asset.port}${asset.transport ? `/${asset.transport}` : ""}`}
				/>
				<Meta label={t("协议")} value={asset.protocol} />
				<Meta label={t("URL")} value={asset.url} />
				<Meta label={t("标题")} value={asset.title} />
				<Meta label={t("服务")} value={asset.server} />
				<Meta label={t("技术栈")} value={asset.tech} />
				<Meta label={t("来源")} value={asset.source} />
				<Meta label={t("会话")} value={asset.sessionName} />
				<Meta label={t("首次发现")} value={formatWhen(asset.firstSeenAt)} />
				<Meta label={t("最近发现")} value={formatWhen(asset.lastSeenAt)} />
				<Meta label={t("测试记录")} value={asset.testCount} />
			</div>

			{inconsistent ? (
				<p className="asset-lib-warn">
					{t("最近一次测试结论为「有漏洞」，但没有关联的漏洞中枢记录；核实后用 vuln_submit 补交。")}
				</p>
			) : null}

			<div className="asset-lib-controls">
				<label className="asset-lib-control">
					<span>{t("状态")}</span>
					<select
						value={asset.status}
						onChange={(event) => onUpdate(asset.id, { status: event.target.value as SentinelAssetState })}
					>
						{SENTINEL_ASSET_STATES.map((state) => (
							<option key={state} value={state}>
								{stateLabel(state)}
							</option>
						))}
					</select>
				</label>
				<label className="asset-lib-control asset-lib-control--grow">
					<span>{t("标签")}</span>
					<input
						value={tags}
						placeholder={t("用逗号分隔，如 OA, 后台")}
						spellCheck={false}
						onChange={(event) => setTags(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") saveTags();
						}}
					/>
				</label>
				<button type="button" onClick={saveTags}>
					{t("保存标签")}
				</button>
			</div>

			<div className="asset-lib-record">
				<div className="asset-lib-record__row">
					<select value={outcome} onChange={(event) => setOutcome(event.target.value as SentinelAssetOutcome)}>
						{SENTINEL_ASSET_OUTCOMES.map((item) => (
							<option key={item} value={item}>
								{SENTINEL_ASSET_OUTCOME_LABELS[item]}
							</option>
						))}
					</select>
					<textarea
						value={note}
						placeholder={t("操作员记录：复核结论、备注或证据出处")}
						rows={2}
						onChange={(event) => setNote(event.target.value)}
					/>
					<button type="button" className="primary" disabled={note.trim() === "" && outcome === "note"} onClick={addRecord}>
						{t("添加记录")}
					</button>
				</div>
			</div>

			<section className="asset-lib-section">
				<h3>{t("时间线")}</h3>
				{asset.entries.length === 0 ? (
					<p className="ws-panel__hint">{t("还没有测试记录：Agent 用 asset_note 记录，操作员也可以在上方添加。")}</p>
				) : (
					<ul className="asset-lib-timeline">
						{asset.entries.map((entry) => (
							<EntryRow key={entry.seq} entry={entry} />
						))}
					</ul>
				)}
			</section>

			<section className="asset-lib-section">
				<h3>{t("关联漏洞")}</h3>
				<VulnLinks vulns={detail.vulns} onOpenVuln={onOpenVuln} />
			</section>
		</Overlay>
	);
}

export function AssetLibraryPage({
	items,
	stats,
	total,
	page,
	pageSize,
	hasMore,
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
	const [selected, setSelected] = useState<Set<string>>(new Set());

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
			const alive = new Set(items.map((item) => item.id));
			const next = new Set([...prev].filter((id) => alive.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [items]);

	const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const changeFilters = (patch: Partial<SentinelAssetFilters>) => {
		onQuery({ ...filters, ...patch }, 1, pageSize);
	};

	const reset = () => {
		setSearch("");
		onQuery({}, 1, pageSize);
	};

	if (!hasProject) {
		return (
			<div className="page-card asset-lib-page">
				<div className="ws-panel__head">
					<div className="ws-panel__title">{t("资产库")}</div>
				</div>
				<div className="ws-panel__body">
					<div className="ws-empty">
						<span>{t("尚未选择项目")}</span>
						<span>{t("资产库按项目隔离，请先在侧栏顶部选择或创建一个项目")}</span>
					</div>
				</div>
			</div>
		);
	}

	const pages = Math.max(1, Math.ceil(total / pageSize));
	const selectedIds = [...selected];

	return (
		<div className="page-card asset-lib-page">
			<div className="ws-panel__head">
				<div className="ws-panel__title">
					{t("资产库")}
					<span className="ws-panel__sub">
						{projectName ? `${projectName} · ` : ""}
						{t("共 {total} 条 · 待测试 {pending}", { total: stats.total, pending: stats.byStatus.pending })}
						{filters.search || filters.kind || filters.status || filters.tested !== undefined
							? ` · ${t("筛选命中 {count} 条", { count: total })}`
							: ""}
					</span>
				</div>
				<div className="ws-panel__actions">
					<button
						type="button"
						disabled={items.length === 0}
						title={t("只选中当前页，不含其他页")}
						onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))}
					>
						{allSelected ? t("取消全选") : t("全选本页")}
					</button>
					<button
						type="button"
						className="danger"
						disabled={selectedIds.length === 0}
						onClick={() => onRequestDelete(selectedIds)}
					>
						<DeleteIcon />
						{t("删除选中 ({count})", { count: selectedIds.length })}
					</button>
					<button type="button" className="primary" onClick={() => onExport(filters)}>
						<DownloadIcon />
						{t("导出 Markdown")}
					</button>
				</div>
			</div>

			<div className="asset-lib-stats">
				{SENTINEL_ASSET_KINDS.map((kind) => (
					<span key={kind} className={`asset-lib-stat asset-lib-kind-${kind}`}>
						{kindLabel(kind)} {stats.byKind[kind]}
					</span>
				))}
				{SENTINEL_ASSET_STATES.map((state) => (
					<span key={state} className={`asset-lib-stat asset-lib-state-${state}`}>
						{stateLabel(state)} {stats.byStatus[state]}
					</span>
				))}
			</div>

			<div className="asset-lib-filters">
				<input
					className="inline-input"
					value={search}
					placeholder={t("搜索编号 / 名称 / URL / 标题 / 标签 / 来源")}
					spellCheck={false}
					onChange={(event) => setSearch(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") changeFilters({ search: search.trim() || undefined });
					}}
				/>
				<select
					className="inline-input"
					value={filters.kind ?? ""}
					onChange={(event) => changeFilters({ kind: (event.target.value || undefined) as SentinelAssetKind | undefined })}
				>
					<option value="">{t("全部类型")}</option>
					{SENTINEL_ASSET_KINDS.map((kind) => (
						<option key={kind} value={kind}>
							{kindLabel(kind)}
						</option>
					))}
				</select>
				<select
					className="inline-input"
					value={filters.status ?? ""}
					onChange={(event) =>
						changeFilters({ status: (event.target.value || undefined) as SentinelAssetState | undefined })
					}
				>
					<option value="">{t("全部状态")}</option>
					{SENTINEL_ASSET_STATES.map((state) => (
						<option key={state} value={state}>
							{stateLabel(state)}
						</option>
					))}
				</select>
				<select
					className="inline-input"
					value={filters.tested === undefined ? "" : filters.tested ? "yes" : "no"}
					onChange={(event) =>
						changeFilters({
							tested: event.target.value === "" ? undefined : event.target.value === "yes",
						})
					}
				>
					<option value="">{t("全部结论")}</option>
					<option value="yes">{t("有结论")}</option>
					<option value="no">{t("无结论")}</option>
				</select>
				<button type="button" className="ghost small" onClick={reset}>
					{t("重置")}
				</button>
			</div>

			<div className="ws-panel__body">
				{items.length === 0 ? (
					<div className="ws-empty">
						<span>{stats.total === 0 ? t("还没有资产记录") : t("没有符合条件的资产")}</span>
						<span>
							{stats.total === 0
								? t("Agent 在探测目标时用 asset_report 上报；需要在「设置 → 权限」开启 asset_library_write")
								: t("调整搜索或筛选条件")}
						</span>
					</div>
				) : (
					<div className="data-table asset-lib-table">
						<div className="data-row data-head">
							<span>
								<input
									type="checkbox"
									checked={allSelected}
									title={t("全选本页")}
									onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))}
								/>
							</span>
							<span>{t("编号")}</span>
							<span>{t("类型")}</span>
							<span>{t("资产")}</span>
							<span>{t("协议")}</span>
							<span>{t("状态")}</span>
							<span>{t("测试")}</span>
							<span>{t("最近发现")}</span>
							<span>{t("来源")}</span>
						</div>
						{items.map((item) => (
							<div
								key={item.id}
								className={`data-row asset-lib-row${selected.has(item.id) ? " selected" : ""}`}
								role="button"
								tabIndex={0}
								onClick={() => onOpen(item.id)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") onOpen(item.id);
								}}
							>
								<span
									onClick={(event) => {
										event.stopPropagation();
									}}
								>
									<input
										type="checkbox"
										checked={selected.has(item.id)}
										onChange={() => toggle(item.id)}
										aria-label={t("选择 {label}", { label: item.label })}
									/>
								</span>
								<span className="data-mono">{item.label}</span>
								<span>
									<span className={`asset-lib-kind asset-lib-kind-${item.kind}`}>{kindLabel(item.kind)}</span>
								</span>
								<span className="asset-lib-name">
									<code>{item.name}</code>
									{item.title ? <small>{item.title}</small> : null}
								</span>
								<span>{item.protocol ?? "—"}</span>
								<span>
									<span className={`asset-lib-state asset-lib-state-${item.status}`}>{stateLabel(item.status)}</span>
								</span>
								<span>{testSummary(item)}</span>
								<span>{formatWhen(item.lastSeenAt)}</span>
								<span>{item.source}</span>
							</div>
						))}
					</div>
				)}

				{items.length > 0 ? (
					<div className="asset-lib-pager">
						<button type="button" className="ghost small" disabled={page <= 1} onClick={() => onQuery(filters, page - 1, pageSize)}>
							{t("上一页")}
						</button>
						<span>{t("第 {page} / {pages} 页 · 共 {total} 条", { page, pages, total })}</span>
						<button
							type="button"
							className="ghost small"
							disabled={!hasMore}
							onClick={() => onQuery(filters, page + 1, pageSize)}
						>
							{t("下一页")}
						</button>
						<select
							className="inline-input"
							value={pageSize}
							onChange={(event) => onQuery(filters, 1, Number(event.target.value))}
						>
							{[20, 50, 100, 200].map((size) => (
								<option key={size} value={size}>
									{t("每页 {size}", { size })}
								</option>
							))}
						</select>
					</div>
				) : null}
			</div>

			{detail ? (
				<AssetDetail
					detail={detail}
					onClose={onCloseDetail}
					onUpdate={onUpdate}
					onRequestDelete={onRequestDelete}
					onOpenVuln={onOpenVuln}
				/>
			) : null}

			{deletePending ? (
				<Overlay
					title={t("删除资产")}
					subtitle={t("删除后不可恢复")}
					className="asset-lib-delete"
					onClose={onCancelDelete}
					actions={
						<>
							<button type="button" onClick={onCancelDelete}>
								{t("取消")}
							</button>
							<button
								type="button"
								className="danger"
								disabled={deletePreview === null}
								onClick={() => onConfirmDelete(deletePending)}
							>
								{t("确认删除")}
							</button>
						</>
					}
				>
					<p>{t("将删除 {count} 条资产。", { count: deletePreview?.count ?? deletePending.length })}</p>
					{deletePreview ? (
						<ul>
							<li>{t("{count} 条时间线记录", { count: deletePreview.records })}</li>
							<li>{t("{count} 条漏洞的关联会被解除（漏洞本身保留）", { count: deletePreview.vulns })}</li>
						</ul>
					) : (
						<p className="ws-panel__sub">{t("正在统计影响…")}</p>
					)}
					<p className="ws-panel__hint">{t("资产、时间线与导出内容都会消失；关联漏洞只解除关联，不删除漏洞记录。")}</p>
				</Overlay>
			) : null}
		</div>
	);
}

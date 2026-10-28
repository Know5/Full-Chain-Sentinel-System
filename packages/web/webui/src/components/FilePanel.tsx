import {
	Alert,
	Breadcrumb,
	Button,
	ConfigProvider,
	Empty,
	Input,
	List,
	Popconfirm,
	Progress,
	Space,
	Tag,
	Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { getLanguage, t } from "../i18n.ts";
import { formatSize } from "../transcript.ts";
import type { SentinelFileEntry, SentinelFilePreview } from "../types.ts";
import { DirIcon, DownloadIcon, FileIcon, ParentDirIcon } from "./icons.tsx";

const { Text } = Typography;

/** The asynchronous folder archive shown in the file panel. */
export type FolderArchivePhase = "starting" | "running" | "cancelling" | "ready" | "failed" | "cancelled";

export interface FolderArchiveState {
	/** Empty while the server has not answered `download_folder` yet. */
	id: string;
	path: string;
	filename: string;
	bytes: number;
	status: FolderArchivePhase;
	size?: number;
	warning?: string;
	error?: string;
}

/** Bytes of the container work directory the panel is currently showing. */
export interface FilePanelState {
	path: string;
	entries: SentinelFileEntry[];
	preview: SentinelFilePreview | null;
	/** True while a request for this panel is in flight. */
	busy: boolean;
}

function formatTime(seconds: number): string {
	if (!seconds) return "";
	return new Date(seconds * 1000).toLocaleString(getLanguage() === "zh" ? "zh-CN" : "en-US", { hour12: false });
}

/** Turn a base64 payload from the server into a browser download. */
export function saveDownload(path: string, base64: string, mimeType: string): void {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = path.split("/").pop() ?? "download";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

/** Read a picked file as base64 without its data-URL prefix. */
function readAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? "");
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.onerror = () => reject(reader.error ?? new Error(t("读取文件失败")));
		reader.readAsDataURL(file);
	});
}

function parentOf(path: string): string {
	if (path === "/work" || !path.startsWith("/work/")) return "/work";
	const trimmed = path.replace(/\/+$/, "");
	const index = trimmed.lastIndexOf("/");
	return index <= 0 ? "/work" : trimmed.slice(0, index);
}

function baseName(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function FilePanel({
	state,
	onOpen,
	onPreview,
	onSave,
	onUpload,
	onDelete,
	onRename,
	onMkdir,
	onDownload,
	archive,
	onDownloadFolder,
	onCancelArchive,
}: {
	state: FilePanelState;
	onOpen: (path: string) => void;
	onPreview: (path: string) => void;
	onSave: (path: string, text: string) => void;
	onUpload: (path: string, data: string) => void;
	onDelete: (path: string) => void;
	onRename: (from: string, to: string) => void;
	onMkdir: (path: string) => void;
	onDownload: (path: string) => void;
	archive: FolderArchiveState | null;
	onDownloadFolder: (path: string) => void;
	onCancelArchive: () => void;
}) {
	const [editing, setEditing] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [renaming, setRenaming] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [newDir, setNewDir] = useState<string | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const uploadRef = useRef<HTMLInputElement | null>(null);
	const archiveBusy =
		archive?.status === "starting" || archive?.status === "running" || archive?.status === "cancelling";

	// Leaving the directory (or reloading it) abandons an in-progress edit buffer.
	useEffect(() => {
		setEditing(null);
		setDraft("");
		setRenaming(null);
		setNewDir(null);
	}, [state.path]);

	const preview = state.preview;
	const previewIsText = preview?.kind === "text";
	const isEditing = previewIsText && editing === preview.path;
	const dirty = isEditing && draft !== (preview.text ?? "");

	const crumbs = useMemo(() => {
		const parts = state.path.split("/").filter(Boolean);
		const trail: { label: string; path: string }[] = [{ label: "work", path: "/work" }];
		let acc = "";
		for (const part of parts) {
			acc += `/${part}`;
			if (acc !== "/work") trail.push({ label: part, path: acc });
		}
		return trail;
	}, [state.path]);

	const startUpload = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		setUploadError(null);
		try {
			for (const file of Array.from(files)) {
				const data = await readAsBase64(file);
				onUpload(`${state.path}/${file.name}`, data);
			}
		} catch (error) {
			setUploadError(error instanceof Error ? error.message : String(error));
		} finally {
			if (uploadRef.current) uploadRef.current.value = "";
		}
	};

	return (
		<ConfigProvider button={{ autoInsertSpace: false }}>
			<div className="filepanel">
				<Space size={6} wrap className="filepanel__toolbar">
					<Button
						size="small"
						icon={<ParentDirIcon />}
						disabled={state.path === "/work"}
						onClick={() => onOpen(parentOf(state.path))}
					>
						{t("上级")}
					</Button>
					<Button size="small" disabled={state.busy} onClick={() => onOpen(state.path)}>
						{t("刷新")}
					</Button>
					<Button size="small" onClick={() => uploadRef.current?.click()}>
						{t("上传")}
					</Button>
					<Button size="small" onClick={() => setNewDir("")}>
						{t("新建目录")}
					</Button>
					<Button
						size="small"
						icon={<DownloadIcon />}
						title={t("后台打包，完成后自动下载")}
						disabled={archiveBusy}
						onClick={() => onDownloadFolder(state.path)}
					>
						{t("下载当前文件夹")}
					</Button>
					<input
						ref={uploadRef}
						type="file"
						multiple
						hidden
						onChange={(event) => void startUpload(event.target.files)}
					/>
				</Space>

				<Breadcrumb
					className="filepanel__crumbs"
					items={crumbs.map((crumb) => ({
						title: (
							<Button type="link" size="small" onClick={() => onOpen(crumb.path)}>
								{crumb.label}
							</Button>
						),
					}))}
				/>

				{archive ? (
					archive.status === "starting" || archive.status === "running" ? (
						<Alert
							type="info"
							showIcon
							className="filepanel__archive"
							title={
								archive.filename
									? t("正在打包 {name}…", { name: archive.filename })
									: t("正在准备打包…")
							}
							description={<Progress percent={100} status="active" showInfo={false} />}
							action={
								<Space size={8}>
									<Text type="secondary">{formatSize(archive.bytes)}</Text>
									{archive.status === "running" ? (
										<Button size="small" onClick={onCancelArchive}>
											{t("取消打包")}
										</Button>
									) : null}
								</Space>
							}
						/>
					) : archive.status === "cancelling" ? (
						<Alert type="info" showIcon className="filepanel__archive" title={t("正在取消打包…")} />
					) : archive.status === "ready" ? (
						<Alert
							type="success"
							showIcon
							className="filepanel__archive"
							title={t("打包完成，已开始下载")}
							description={archive.warning}
							action={<Text type="secondary">{formatSize(archive.size ?? archive.bytes)}</Text>}
						/>
					) : archive.status === "failed" ? (
						<Alert
							type="error"
							showIcon
							className="filepanel__archive"
							title={t("打包失败：{error}", { error: archive.error ?? t("未知错误") })}
						/>
					) : (
						<Alert type="info" showIcon className="filepanel__archive" title={t("已取消打包")} />
					)
				) : null}

				{uploadError ? <Alert type="error" showIcon title={uploadError} /> : null}

				{newDir !== null ? (
					<Space.Compact className="filepanel__inline">
						<Input
							autoFocus
							value={newDir}
							placeholder={t("目录名")}
							onChange={(event) => setNewDir(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") setNewDir(null);
								if (event.key === "Enter" && newDir.trim()) {
									onMkdir(`${state.path}/${newDir.trim()}`);
									setNewDir(null);
								}
							}}
						/>
						<Button
							type="primary"
							disabled={!newDir.trim()}
							onClick={() => {
								onMkdir(`${state.path}/${newDir.trim()}`);
								setNewDir(null);
							}}
						>
							{t("创建")}
						</Button>
						<Button onClick={() => setNewDir(null)}>{t("取消")}</Button>
					</Space.Compact>
				) : null}

				<div className="filepanel__list">
					{state.entries.length === 0 ? (
						<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("空目录")} />
					) : null}
					{state.entries.map((entry) => (
						<div
							key={entry.path}
							className={preview?.path === entry.path ? "filepanel__row is-active" : "filepanel__row"}
						>
							{renaming === entry.path ? (
								<Space.Compact className="filepanel__rename">
									<Input
										autoFocus
										value={renameValue}
										onChange={(event) => setRenameValue(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Escape") setRenaming(null);
											if (event.key === "Enter" && renameValue.trim()) {
												onRename(entry.path, `${state.path}/${renameValue.trim()}`);
												setRenaming(null);
											}
										}}
									/>
									<Button
										type="primary"
										disabled={!renameValue.trim()}
										onClick={() => {
											onRename(entry.path, `${state.path}/${renameValue.trim()}`);
											setRenaming(null);
										}}
									>
										{t("确定")}
									</Button>
									<Button onClick={() => setRenaming(null)}>{t("取消")}</Button>
								</Space.Compact>
							) : (
								<>
									<Button
										type="text"
										className="filepanel__open"
										title={entry.path}
										onClick={() => (entry.type === "dir" ? onOpen(entry.path) : onPreview(entry.path))}
									>
										<span className="filepanel__icon">
											{entry.type === "dir" ? <DirIcon /> : <FileIcon />}
										</span>
										<Text className="filepanel__name">{entry.name}</Text>
										<Text type="secondary" className="filepanel__meta">
											{entry.type === "dir" ? t("目录") : formatSize(entry.size)} · {formatTime(entry.mtime)}
										</Text>
									</Button>
									<Space size={2} className="filepanel__ops">
										{entry.type === "dir" ? (
											<Button
												size="small"
												type="link"
												title={t("后台打包整个目录，完成后自动下载")}
												disabled={archiveBusy}
												onClick={() => onDownloadFolder(entry.path)}
											>
												{t("下载")}
											</Button>
										) : null}
										<Button
											size="small"
											type="link"
											title={t("重命名")}
											onClick={() => {
												setRenaming(entry.path);
												setRenameValue(entry.name);
											}}
										>
											{t("改名")}
										</Button>
										<Popconfirm
											title={t("确定删除 {name}？{suffix}", {
												name: entry.name,
												suffix: entry.type === "dir" ? t("目录内的文件会一并删除。") : "",
											})}
											okText={t("删除")}
											okButtonProps={{ danger: true }}
											cancelText={t("取消")}
											onConfirm={() => onDelete(entry.path)}
										>
											<Button size="small" type="link" danger title={t("删除（目录会连同内容一起删除）")}>
												{t("删除")}
											</Button>
										</Popconfirm>
									</Space>
								</>
							)}
						</div>
					))}
				</div>

				{preview ? (
					<div className="filepanel__preview">
						<Space size={8} wrap className="filepanel__previewhead">
							<Text strong className="filepanel__previewname" title={preview.path}>
								{baseName(preview.path)}
							</Text>
							<Text type="secondary">
								{preview.kind === "binary" ? t("二进制") : preview.kind === "image" ? t("图片") : t("文本")} ·{" "}
								{formatSize(preview.size)}
								{preview.truncated ? t(" · 已截断") : ""}
							</Text>
							<Button size="small" onClick={() => onDownload(preview.path)}>
								{t("下载")}
							</Button>
							{previewIsText && !isEditing ? (
								<Button
									size="small"
									onClick={() => {
										setEditing(preview.path);
										setDraft(preview.text ?? "");
									}}
								>
									{t("编辑")}
								</Button>
							) : null}
							{isEditing ? (
								<>
									<Button
										size="small"
										type="primary"
										disabled={!dirty}
										onClick={() => {
											onSave(preview.path, draft);
											setEditing(null);
										}}
									>
										{t("保存")}
									</Button>
									<Button
										size="small"
										onClick={() => {
											setEditing(null);
											setDraft("");
										}}
									>
										{t("取消")}
									</Button>
								</>
							) : null}
						</Space>
						{isEditing ? (
							<Input.TextArea
								className="filepanel__editor"
								value={draft}
								spellCheck={false}
								autoSize={{ minRows: 8, maxRows: 20 }}
								onChange={(event) => setDraft(event.target.value)}
							/>
						) : preview.kind === "image" && preview.data ? (
							<img
								className="filepanel__image"
								src={`data:${preview.mimeType};base64,${preview.data}`}
								alt={preview.path}
							/>
						) : preview.kind === "text" ? (
							<pre className="filepanel__text">{preview.text}</pre>
						) : (
							<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("二进制文件不提供预览，可下载后查看。")} />
						)}
					</div>
				) : (
					<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("选择一个文件查看内容")} />
				)}
			</div>
		</ConfigProvider>
	);
}

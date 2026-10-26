/**
 * Render checks for the file panel's folder-archive controls: both entry points,
 * the running status with cancel, and the ready/failed states. The real archive
 * flow is covered by the server tests; here the point is that a missing control
 * or a null archive fails a render instead of a live click.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { FilePanel, type FolderArchiveState } from "./FilePanel.tsx";

const base = {
	state: {
		path: "/work",
		entries: [
			{ name: "sub", path: "/work/sub", type: "dir" as const, size: 0, mtime: 0 },
			{ name: "a.txt", path: "/work/a.txt", type: "file" as const, size: 3, mtime: 0 },
		],
		preview: null,
		busy: false,
	},
	onOpen: () => {},
	onPreview: () => {},
	onSave: () => {},
	onUpload: () => {},
	onDelete: () => {},
	onRename: () => {},
	onMkdir: () => {},
	onDownload: () => {},
	onDownloadFolder: () => {},
	onCancelArchive: () => {},
};

function archive(overrides: Partial<FolderArchiveState>): FolderArchiveState {
	return {
		id: "a1",
		path: "/work/sub",
		filename: "sub.tar.gz",
		bytes: 0,
		status: "running",
		...overrides,
	};
}

test("both the current folder and each directory row offer a download", () => {
	const html = renderToStaticMarkup(<FilePanel {...base} archive={null} />);
	expect(html).toContain("下载当前文件夹");
	// One row action for the directory, none for the file.
	expect((html.match(/>下载<\/button>/g) ?? []).length).toBe(1);
});

test("a running archive shows bytes and a cancel control", () => {
	const html = renderToStaticMarkup(
		<FilePanel {...base} archive={archive({ status: "running", bytes: 2048 })} />,
	);
	expect(html).toContain("正在打包");
	expect(html).toContain("取消打包");
	expect(html).toContain("sub.tar.gz");
	expect(html).toContain("disabled");
});

test("ready and failed archives show their outcome", () => {
	const ready = renderToStaticMarkup(
		<FilePanel {...base} archive={archive({ status: "ready", size: 4096, bytes: 4096 })} />,
	);
	expect(ready).toContain("打包完成，已开始下载");
	expect(ready).not.toContain("取消打包");

	const failed = renderToStaticMarkup(
		<FilePanel {...base} archive={archive({ status: "failed", error: "tar: boom" })} />,
	);
	expect(failed).toContain("打包失败");
	expect(failed).toContain("tar: boom");
});

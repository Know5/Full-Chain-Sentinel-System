import { UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Typography, Upload } from "antd";
import type { UploadFile } from "antd";
import { useState } from "react";
import { getLanguage, t } from "../i18n.ts";
import type { SentinelProjectInfo } from "../types.ts";
import { MAX_UPLOAD_BYTES, type UploadedFile, uploadFile } from "../uploads.ts";

export function EngineTargetFiles({ project, files, onChange }: {
	project: SentinelProjectInfo | null;
	files: UploadFile<UploadedFile>[];
	onChange(files: UploadFile<UploadedFile>[]): void;
}) {
	const [error, setError] = useState<string | null>(null);
	return (
		<div className="engine-target-files">
			<Upload<UploadedFile>
				multiple
				disabled={!project}
				fileList={files}
				beforeUpload={(file) => {
					setError(null);
					if (file.size > MAX_UPLOAD_BYTES) {
						setError(t("上传失败：文件超过 {max}MB 上限", { max: MAX_UPLOAD_BYTES / 1024 / 1024 }));
						return Upload.LIST_IGNORE;
					}
					return true;
				}}
				customRequest={({ file, onProgress, onSuccess, onError }) => {
					if (!project || !(file instanceof File)) {
						onError?.(new Error(t("请先选择项目")));
						return;
					}
					void uploadFile(file, project.id, (ratio) => onProgress?.({ percent: ratio * 100 }))
						.then((uploaded) => {
							const cwd = project.cwd.replaceAll("\\", "/").replace(/\/$/, "");
							if (!uploaded.path.replaceAll("\\", "/").startsWith(`${cwd}/uploads/`)) {
								throw new Error(getLanguage() === "en" ? "Project changed; upload the file again." : "项目已切换，请重新上传文件。");
							}
							onSuccess?.(uploaded);
						})
						.catch((cause: unknown) => onError?.(cause instanceof Error ? cause : new Error(String(cause))));
				}}
				onChange={({ fileList }) => onChange(fileList)}
			>
				<Button icon={<UploadOutlined />}>{getLanguage() === "en" ? "Upload files" : "上传文件"}</Button>
			</Upload>
			<Typography.Text type="secondary" className="engine-target-files__hint">
				{getLanguage() === "en"
					? "Attach target lists, challenge files, images, or archives; up to 64 MB per file. The commander arranges analysis alongside your description."
					: "可上传目标清单、题目附件、图片或压缩包，单文件不超过 64 MB。指挥官会结合文字描述安排分析。"}
			</Typography.Text>
			{error ? <Alert type="error" showIcon title={error} /> : null}
		</div>
	);
}

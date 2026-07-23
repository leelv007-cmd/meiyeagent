"use client";

import type { AdvancedCanvasRevision } from "@meiye/core/pro-studio";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	type CanvasExportRequest,
	resolveCanvasExportIntent,
} from "./canvas-export-client";

type DialogSurfaceProps = {
	children: ReactNode;
	description?: string;
	onClose(): void;
	title: string;
};

function DialogSurface({
	children,
	description,
	onClose,
	title,
}: DialogSurfaceProps) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);
	const previousFocusRef = useRef<HTMLElement | null>(null);
	onCloseRef.current = onClose;

	useEffect(() => {
		previousFocusRef.current = document.activeElement as HTMLElement | null;
		const timer = window.setTimeout(() => {
			const focusable = dialogRef.current?.querySelector<HTMLElement>(
				'[data-dialog-autofocus], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
			);
			focusable?.focus();
		});
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;
			const focusable = Array.from(
				dialogRef.current?.querySelectorAll<HTMLElement>(
					'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
				) ?? [],
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("keydown", onKeyDown);
			previousFocusRef.current?.focus();
		};
	}, []);

	return (
		<div className="canvas-dialog-backdrop" role="presentation">
			<div
				aria-describedby={description ? "canvas-dialog-description" : undefined}
				aria-labelledby="canvas-dialog-title"
				aria-modal="true"
				className="canvas-dialog"
				ref={dialogRef}
				role="dialog"
			>
				<h2 id="canvas-dialog-title">{title}</h2>
				{description ? (
					<p
						className="canvas-dialog-description"
						id="canvas-dialog-description"
					>
						{description}
					</p>
				) : null}
				{children}
			</div>
		</div>
	);
}

type ProjectNameDialogProps = {
	busy?: boolean;
	initialName: string;
	mode: "create" | "rename";
	onClose(): void;
	onSubmit(name: string): void;
};

export function ProjectNameDialog({
	busy = false,
	initialName,
	mode,
	onClose,
	onSubmit,
}: ProjectNameDialogProps) {
	const [name, setName] = useState(initialName);
	const isCreate = mode === "create";
	return (
		<DialogSurface
			description={
				isCreate ? "为新工程填写商家可见名称。" : "修改工程的商家可见名称。"
			}
			onClose={onClose}
			title={isCreate ? "新建工程" : "重命名工程"}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const nextName = name.trim();
					if (nextName) onSubmit(nextName);
				}}
			>
				<label className="canvas-dialog-field" htmlFor="canvas-project-name">
					<span>工程名称</span>
					<input
						data-dialog-autofocus
						disabled={busy}
						id="canvas-project-name"
						maxLength={120}
						onChange={(event) => setName(event.target.value)}
						value={name}
					/>
				</label>
				<div className="canvas-dialog-actions">
					<button disabled={busy} onClick={onClose} type="button">
						取消
					</button>
					<button disabled={busy || !name.trim()} type="submit">
						{isCreate ? "创建工程" : "保存名称"}
					</button>
				</div>
			</form>
		</DialogSurface>
	);
}

type DeleteProjectsDialogProps = {
	busy?: boolean;
	onClose(): void;
	onConfirm(): void;
	projects: Array<{ id: string; name: string }>;
};

export function DeleteProjectsDialog({
	busy = false,
	onClose,
	onConfirm,
	projects,
}: DeleteProjectsDialogProps) {
	return (
		<DialogSurface
			description={`将 ${projects.length} 个工程移入回收保留区；可以稍后按保留策略恢复。`}
			onClose={onClose}
			title={`删除 ${projects.length} 个工程？`}
		>
			<ul className="canvas-dialog-project-list">
				{projects.map((project) => (
					<li key={project.id}>{project.name}</li>
				))}
			</ul>
			<div className="canvas-dialog-actions">
				<button
					data-dialog-autofocus
					disabled={busy}
					onClick={onClose}
					type="button"
				>
					取消
				</button>
				<button
					className="danger"
					disabled={busy || projects.length === 0}
					onClick={onConfirm}
					type="button"
				>
					移入回收保留区
				</button>
			</div>
		</DialogSurface>
	);
}

type RestoreRevisionDialogProps = {
	busy?: boolean;
	onClose(): void;
	onConfirm(): void;
	revisionLabel: string;
};

export function RestoreRevisionDialog({
	busy = false,
	onClose,
	onConfirm,
	revisionLabel,
}: RestoreRevisionDialogProps) {
	return (
		<DialogSurface
			description={`将以“${revisionLabel}”的冻结内容开启一个新草稿；现有检查点不会被修改。`}
			onClose={onClose}
			title="恢复为新草稿？"
		>
			<div className="canvas-dialog-actions">
				<button
					data-dialog-autofocus
					disabled={busy}
					onClick={onClose}
					type="button"
				>
					取消
				</button>
				<button disabled={busy} onClick={onConfirm} type="button">
					创建新草稿
				</button>
			</div>
		</DialogSurface>
	);
}

type CanvasExportDialogProps = {
	busy?: boolean;
	onClose(): void;
	onExport(input: CanvasExportRequest): void;
	projectId: string;
	projectName: string;
	revisions: AdvancedCanvasRevision[];
};

export function CanvasExportDialog({
	busy = false,
	onClose,
	onExport,
	projectId,
	projectName,
	revisions,
}: CanvasExportDialogProps) {
	const [revisionId, setRevisionId] = useState(revisions.at(-1)?.id ?? "");
	const [includeAvailableOnly, setIncludeAvailableOnly] = useState(false);
	const exportIntentRef = useRef<CanvasExportRequest | null>(null);
	function submitExport() {
		const intent = resolveCanvasExportIntent(exportIntentRef.current, {
			...(includeAvailableOnly ? { includeAvailableOnly: true } : {}),
			projectId,
			revisionId,
		});
		exportIntentRef.current = intent;
		onExport(intent);
	}
	return (
		<DialogSurface
			description={`导出“${projectName}”的冻结检查点。ZIP 保持独立 Canvas manifest，不会写入 ContentPackage。`}
			onClose={onClose}
			title="导出工程"
		>
			<label className="canvas-dialog-field" htmlFor="canvas-export-revision">
				<span>冻结检查点</span>
				<select
					data-dialog-autofocus
					disabled={busy || revisions.length === 0}
					id="canvas-export-revision"
					onChange={(event) => setRevisionId(event.target.value)}
					value={revisionId}
				>
					{revisions.map((revision) => (
						<option key={revision.id} value={revision.id}>
							{revision.label ?? revisionReasonLabel(revision.reason)} ·{" "}
							{formatRevisionTime(revision.createdAt)}
						</option>
					))}
				</select>
			</label>
			<label
				className="canvas-dialog-check"
				htmlFor="canvas-export-available-only"
			>
				<input
					checked={includeAvailableOnly}
					disabled={busy}
					id="canvas-export-available-only"
					onChange={(event) => setIncludeAvailableOnly(event.target.checked)}
					type="checkbox"
				/>
				<span>只导出当前可用项</span>
			</label>
			<p className="canvas-dialog-hint">
				默认会在任一素材无权导出时停止；勾选后才由服务端跳过不可用项。
			</p>
			<div className="canvas-dialog-actions">
				<button disabled={busy} onClick={onClose} type="button">
					取消
				</button>
				<button
					disabled={busy || !revisionId}
					onClick={submitExport}
					type="button"
				>
					{busy ? "正在准备 ZIP…" : "下载 ZIP"}
				</button>
			</div>
		</DialogSurface>
	);
}

function revisionReasonLabel(reason: AdvancedCanvasRevision["reason"]) {
	switch (reason) {
		case "adoption":
			return "采用快照";
		case "agent":
			return "智能编辑快照";
		case "checkpoint":
			return "检查点";
	}
}

function formatRevisionTime(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "时间未知";
	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

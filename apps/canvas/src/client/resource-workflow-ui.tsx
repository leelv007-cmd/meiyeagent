"use client";

import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CatalogEntry } from "../kernel-host/generation-adapter";
import { assetDeliveryUrl } from "./backend-client";
import {
	acceptCursorListPage,
	assetListRequest,
	beginCursorListRequest,
	type CanvasAssetListItem,
	type CanvasCursorListState,
	type CanvasCursorPage,
	type CanvasPromptListItem,
	clampPlainTextSelection,
	filterResourceMentionCandidates,
	findResourceMentionRange,
	initialCursorListState,
	insertResourceMention,
	mentionKeyboardAction,
	promptCategoryPresentation,
	promptCompatibility,
	promptListRequest,
	type ResourceDraft,
	type ResourceMention,
	type ResourceMentionCandidate,
	rejectCursorListRequest,
	removeResourceMention,
	replaceResourceMention,
	resourceDraftWithPlainText,
	resourceKindLabel,
	safeAssetTitle,
	safePromptPresentation,
	validateCanvasUpload,
} from "./resource-workflow";

type PromptLibraryProps = {
	catalog: readonly CatalogEntry[];
	loadPage(input: {
		category?: string;
		cursor?: string;
		query?: string;
	}): Promise<CanvasCursorPage<CanvasPromptListItem>>;
	onSelect(prompt: CanvasPromptListItem): void;
	operation: CanvasGenerationOperation;
};

type CanvasAssetPickerProps = {
	loadPage(input: {
		cursor?: string;
		kind?: "audio" | "image" | "video";
		query?: string;
	}): Promise<CanvasCursorPage<CanvasAssetListItem>>;
	onClose(): void;
	onInsert(asset: CanvasAssetListItem): void;
	onUpload?(file: File): Promise<CanvasAssetListItem | null>;
	open: boolean;
};

type ResourceMentionComposerProps = {
	disabled?: boolean;
	draft: ResourceDraft;
	loadAssets(input: {
		cursor?: string;
		kind?: "audio" | "image" | "video";
		query?: string;
	}): Promise<CanvasCursorPage<CanvasAssetListItem>>;
	nodeCandidates: readonly ResourceMentionCandidate[];
	onChange(draft: ResourceDraft): void;
};

export function PromptLibrary({
	catalog,
	loadPage,
	onSelect,
	operation,
}: PromptLibraryProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<string | undefined>();
	const [list, setList] = useState<CanvasCursorListState<CanvasPromptListItem>>(
		initialCursorListState,
	);
	const latestRequest = useRef(0);

	const requestPage = useCallback(
		async (cursor: string | undefined, append: boolean) => {
			const request = ++latestRequest.current;
			setList((current) => beginCursorListRequest(current, append));
			try {
				const page = await loadPage(
					promptListRequest({ category, cursor, query }),
				);
				if (request !== latestRequest.current) return;
				setList((current) => acceptCursorListPage(current, page, append));
			} catch {
				if (request !== latestRequest.current) return;
				setList((current) => rejectCursorListRequest(current));
			}
		},
		[category, loadPage, query],
	);

	useEffect(() => {
		if (!open) return;
		void requestPage(undefined, false);
		return () => {
			latestRequest.current += 1;
		};
	}, [open, requestPage]);

	const categories = useMemo(() => {
		const values = new Map<string, string>();
		for (const item of list.items) {
			if (!item.category?.trim()) continue;
			values.set(
				item.category,
				promptCategoryPresentation(item.category).label,
			);
		}
		return [...values.entries()];
	}, [list.items]);

	return (
		<div className="resource-prompt-library">
			<button type="button" onClick={() => setOpen(true)}>
				提示词库
			</button>
			{open ? (
				<div
					aria-label="提示词库"
					aria-modal="true"
					className="resource-dialog-backdrop"
					onKeyDown={(event) => {
						if (event.key === "Escape") setOpen(false);
					}}
					role="dialog"
				>
					<div className="resource-dialog resource-prompt-dialog">
						<div className="resource-dialog-heading">
							<div>
								<h3>提示词库</h3>
								<p>按当前创作能力筛选，仅可插入兼容提示词。</p>
							</div>
							<button
								aria-label="关闭提示词库"
								type="button"
								onClick={() => setOpen(false)}
							>
								关闭
							</button>
						</div>
						<label className="resource-search">
							<span>搜索提示词</span>
							<input
								placeholder="按标题或内容搜索"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
						</label>
						<div
							aria-label="提示词分类"
							className="resource-tabs"
							role="tablist"
						>
							<button
								aria-selected={category === undefined}
								className={category === undefined ? "active" : ""}
								onClick={() => setCategory(undefined)}
								role="tab"
								type="button"
							>
								全部
							</button>
							{categories.map(([value, label]) => (
								<button
									aria-selected={category === value}
									className={category === value ? "active" : ""}
									key={value}
									onClick={() => setCategory(value)}
									role="tab"
									type="button"
								>
									{label}
								</button>
							))}
						</div>
						<PromptResults
							catalog={catalog}
							items={list.items}
							onSelect={(item) => {
								onSelect(item);
								setOpen(false);
							}}
							operation={operation}
							status={list.status}
						/>
						{list.error ? (
							<output aria-live="polite" className="resource-error">
								提示词暂时无法载入，请稍后重试。
							</output>
						) : null}
						{list.nextCursor ? (
							<button
								className="resource-load-more"
								disabled={list.status === "loading"}
								onClick={() =>
									void requestPage(list.nextCursor ?? undefined, true)
								}
								type="button"
							>
								加载更多提示词
							</button>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}

function PromptResults({
	catalog,
	items,
	onSelect,
	operation,
	status,
}: {
	catalog: readonly CatalogEntry[];
	items: readonly CanvasPromptListItem[];
	onSelect(item: CanvasPromptListItem): void;
	operation: CanvasGenerationOperation;
	status: CanvasCursorListState<CanvasPromptListItem>["status"];
}) {
	if (status === "loading" && items.length === 0) {
		return <p className="resource-loading">正在载入提示词…</p>;
	}
	if (status !== "loading" && items.length === 0) {
		return <p className="resource-empty">没有符合条件的提示词。</p>;
	}
	return (
		<div className="resource-prompt-results">
			{items.map((item) => {
				const presentation = safePromptPresentation(item);
				const compatibility = promptCompatibility(item, operation, catalog);
				return (
					<article className="resource-prompt-card" key={item.id}>
						<div>
							<span className="resource-category">{presentation.category}</span>
							<strong>{presentation.title}</strong>
							<p>{presentation.purpose}</p>
						</div>
						<button
							disabled={!compatibility.compatible}
							onClick={() => onSelect(item)}
							title={compatibility.reason}
							type="button"
						>
							{compatibility.compatible ? "插入" : "暂不可用"}
						</button>
						{compatibility.reason ? (
							<output aria-live="polite" className="resource-incompatible">
								{compatibility.reason}
							</output>
						) : null}
					</article>
				);
			})}
		</div>
	);
}

export function CanvasAssetPicker({
	loadPage,
	onClose,
	onInsert,
	onUpload,
	open,
}: CanvasAssetPickerProps) {
	const [kind, setKind] = useState<"audio" | "image" | "video">("image");
	const [query, setQuery] = useState("");
	const [list, setList] = useState<CanvasCursorListState<CanvasAssetListItem>>(
		initialCursorListState,
	);
	const [uploadError, setUploadError] = useState("");
	const [uploading, setUploading] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const latestRequest = useRef(0);

	const requestPage = useCallback(
		async (cursor: string | undefined, append: boolean) => {
			const request = ++latestRequest.current;
			setList((current) => beginCursorListRequest(current, append));
			try {
				const page = await loadPage(assetListRequest({ cursor, kind, query }));
				if (request !== latestRequest.current) return;
				setList((current) => acceptCursorListPage(current, page, append));
			} catch {
				if (request !== latestRequest.current) return;
				setList((current) => rejectCursorListRequest(current));
			}
		},
		[kind, loadPage, query],
	);

	useEffect(() => {
		if (!open) return;
		void requestPage(undefined, false);
		return () => {
			latestRequest.current += 1;
		};
	}, [open, requestPage]);

	async function upload(file: File) {
		const validation = validateCanvasUpload(file);
		if (validation) {
			setUploadError(validation);
			return;
		}
		if (!onUpload) return;
		setUploadError("");
		setUploading(true);
		try {
			const uploaded = await onUpload(file);
			if (!uploaded) return;
			onInsert(uploaded);
			await requestPage(undefined, false);
		} catch {
			setUploadError("上传未完成，请稍后重试。");
		} finally {
			setUploading(false);
		}
	}

	if (!open) return null;
	return (
		<div
			aria-label="素材选择器"
			aria-modal="true"
			className="resource-dialog-backdrop"
			onKeyDown={(event) => {
				if (event.key === "Escape") onClose();
			}}
			role="dialog"
		>
			<div className="resource-dialog resource-asset-dialog">
				<div className="resource-dialog-heading">
					<div>
						<h3>选择素材</h3>
						<p>素材由服务端按当前工作区授权返回。</p>
					</div>
					<button aria-label="关闭素材选择器" type="button" onClick={onClose}>
						关闭
					</button>
				</div>
				<div aria-label="素材类型" className="resource-tabs" role="tablist">
					{(
						[
							["image", "图片"],
							["video", "视频"],
							["audio", "音频"],
						] as const
					).map(([value, label]) => (
						<button
							aria-selected={kind === value}
							className={kind === value ? "active" : ""}
							key={value}
							onClick={() => setKind(value)}
							role="tab"
							type="button"
						>
							{label}
						</button>
					))}
				</div>
				<div className="resource-picker-controls">
					<label className="resource-search">
						<span>搜索素材</span>
						<input
							placeholder="按素材名称搜索"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</label>
					{onUpload ? (
						<>
							<button
								disabled={uploading}
								onClick={() => inputRef.current?.click()}
								type="button"
							>
								{uploading ? "正在上传…" : "上传并插入"}
							</button>
							<input
								accept="image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/wav"
								hidden
								ref={inputRef}
								type="file"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) void upload(file);
									event.currentTarget.value = "";
								}}
							/>
						</>
					) : null}
				</div>
				<p className="resource-server-note">
					浏览器会先提示类型和大小；服务端仍会复核工作区、归属与媒体内容。
				</p>
				{uploadError ? <p className="resource-error">{uploadError}</p> : null}
				<AssetResults
					items={list.items}
					onInsert={(asset) => {
						onInsert(asset);
						onClose();
					}}
					status={list.status}
				/>
				{list.error ? (
					<output aria-live="polite" className="resource-error">
						素材暂时无法载入，请稍后重试。
					</output>
				) : null}
				{list.nextCursor ? (
					<button
						className="resource-load-more"
						disabled={list.status === "loading"}
						onClick={() => void requestPage(list.nextCursor ?? undefined, true)}
						type="button"
					>
						加载更多素材
					</button>
				) : null}
			</div>
		</div>
	);
}

function AssetResults({
	items,
	onInsert,
	status,
}: {
	items: readonly CanvasAssetListItem[];
	onInsert(asset: CanvasAssetListItem): void;
	status: CanvasCursorListState<CanvasAssetListItem>["status"];
}) {
	if (status === "loading" && items.length === 0) {
		return <p className="resource-loading">正在载入素材…</p>;
	}
	if (status !== "loading" && items.length === 0) {
		return <p className="resource-empty">没有符合条件的素材。</p>;
	}
	return (
		<div className="resource-asset-grid">
			{items.map((asset) => (
				<article className="resource-asset-card" key={asset.id}>
					<AssetPreview asset={asset} />
					<div>
						<strong>{safeAssetTitle(asset)}</strong>
						<span>{resourceKindLabel(asset.kind)}</span>
					</div>
					<button type="button" onClick={() => onInsert(asset)}>
						插入画布
					</button>
				</article>
			))}
		</div>
	);
}

function AssetPreview({ asset }: { asset: CanvasAssetListItem }) {
	const url = assetDeliveryUrl(asset.id);
	const label = safeAssetTitle(asset);
	if (asset.kind === "image") {
		return (
			// biome-ignore lint/performance/noImgElement: private authenticated delivery is not an image optimizer source.
			<img alt={label} loading="lazy" src={url} />
		);
	}
	if (asset.kind === "video") {
		return (
			<video
				aria-label={`${label}预览`}
				controls
				muted
				preload="metadata"
				src={url}
			/>
		);
	}
	return (
		// biome-ignore lint/a11y/useMediaCaption: owned uploads do not have a trusted transcript to attach to the preview.
		<audio aria-label={`${label}预览`} controls preload="metadata" src={url} />
	);
}

export function ResourceMentionComposer({
	disabled = false,
	draft,
	loadAssets,
	nodeCandidates,
	onChange,
}: ResourceMentionComposerProps) {
	const [mention, setMention] =
		useState<ReturnType<typeof findResourceMentionRange>>(null);
	const [assetList, setAssetList] = useState<
		CanvasCursorListState<CanvasAssetListItem>
	>(initialCursorListState);
	const [activeIndex, setActiveIndex] = useState(0);
	const editorRef = useRef<HTMLDivElement>(null);
	const requestId = useRef(0);
	const listboxId = useId();

	const candidates = useMemo(() => {
		return filterResourceMentionCandidates({
			assets: assetList.items,
			nodes: nodeCandidates,
			query: mention?.query ?? "",
		});
	}, [assetList.items, mention?.query, nodeCandidates]);

	const requestAssets = useCallback(
		async (cursor: string | undefined, append: boolean) => {
			if (!mention) return;
			const request = ++requestId.current;
			setAssetList((current) => beginCursorListRequest(current, append));
			try {
				const page = await loadAssets(
					assetListRequest({ cursor, query: mention.query }),
				);
				if (request !== requestId.current) return;
				setAssetList((current) => acceptCursorListPage(current, page, append));
			} catch {
				if (request !== requestId.current) return;
				setAssetList((current) => rejectCursorListRequest(current));
			}
		},
		[loadAssets, mention],
	);

	useEffect(() => {
		if (!mention) return;
		setActiveIndex(0);
		void requestAssets(undefined, false);
		return () => {
			requestId.current += 1;
		};
	}, [mention, requestAssets]);

	function updatePrompt(prompt: string, cursor: number) {
		const nextDraft = resourceDraftWithPlainText(draft, prompt);
		onChange(nextDraft);
		setMention(findResourceMentionRange(nextDraft.prompt, cursor));
		focusEditorAt(cursor);
	}

	function focusEditorAt(offset: number) {
		requestAnimationFrame(() => {
			const editor = editorRef.current;
			if (!editor) return;
			editor.focus();
			setEditorSelection(editor, offset);
		});
	}

	function replaceEditorSelection(value: string) {
		const editor = editorRef.current;
		if (!editor) return;
		const range = editorSelectionOffsets(editor);
		const prompt = editorPlainText(editor);
		const nextPrompt = `${prompt.slice(0, range.start)}${value}${prompt.slice(range.end)}`;
		updatePrompt(nextPrompt, range.start + value.length);
	}

	function selectCandidate(candidate: ResourceMentionCandidate) {
		if (!mention) return;
		const inserted = insertResourceMention(draft, mention, candidate);
		onChange(inserted.draft);
		setMention(null);
		setActiveIndex(0);
		focusEditorAt(inserted.cursor);
	}

	function removeMention(mentionToRemove: ResourceMention) {
		const nextDraft = removeResourceMention(draft, mentionToRemove);
		onChange(nextDraft);
		focusEditorAt(nextDraft.prompt.length);
	}

	function replaceMention(mentionToReplace: ResourceMention) {
		const replacement = replaceResourceMention(draft, mentionToReplace);
		onChange(replacement.draft);
		setMention({
			end: replacement.cursor,
			query: "",
			start: replacement.cursor - 1,
		});
		focusEditorAt(replacement.cursor);
	}

	function openMentionAtEnd() {
		const cursor = draft.prompt.length;
		const needsSpace = cursor > 0 && !/\s$/u.test(draft.prompt);
		const prompt = `${draft.prompt}${needsSpace ? " " : ""}@`;
		const nextCursor = prompt.length;
		onChange({ ...draft, prompt });
		setMention({ end: nextCursor, query: "", start: nextCursor - 1 });
		focusEditorAt(nextCursor);
	}

	const menuOpen = Boolean(mention);
	const activeCandidate = candidates.at(
		Math.min(activeIndex, Math.max(candidates.length - 1, 0)),
	);
	return (
		<div className="resource-mention-composer">
			<div className="resource-composer-heading">
				<span>生成提示词</span>
				<button disabled={disabled} onClick={openMentionAtEnd} type="button">
					@ 引用资源
				</button>
			</div>
			<div className="resource-mention-input-wrap">
				{/* biome-ignore lint/a11y/useSemanticElements: G34 requires a rich contentEditable textbox for @ mentions. */}
				<div
					aria-activedescendant={
						menuOpen && activeCandidate
							? `${listboxId}-option-${Math.min(activeIndex, candidates.length - 1)}`
							: undefined
					}
					aria-controls={menuOpen ? listboxId : undefined}
					aria-disabled={disabled || undefined}
					aria-label="生成提示词，可输入 @ 引用已连接节点或素材"
					aria-multiline="true"
					aria-placeholder="输入生成指令，或输入 @ 引用资源"
					className="resource-mention-editor"
					contentEditable={!disabled}
					data-placeholder="输入生成指令，或输入 @ 引用资源"
					ref={editorRef}
					role="textbox"
					suppressContentEditableWarning
					tabIndex={disabled ? -1 : 0}
					onInput={(event) => {
						const editor = event.currentTarget;
						updatePrompt(
							editorPlainText(editor),
							editorSelectionOffsets(editor).end,
						);
					}}
					onPaste={(event) => {
						event.preventDefault();
						replaceEditorSelection(event.clipboardData.getData("text/plain"));
					}}
					onKeyDown={(event) => {
						if (!menuOpen && event.key === "Enter") {
							event.preventDefault();
							replaceEditorSelection("\n");
							return;
						}
						if (!menuOpen) return;
						const action = mentionKeyboardAction(
							event.key,
							activeIndex,
							candidates.length,
						);
						if (action.kind === "none") return;
						event.preventDefault();
						if (action.kind === "move") {
							setActiveIndex(action.index);
							return;
						}
						if (action.kind === "select") {
							const candidate = candidates[action.index];
							if (candidate) selectCandidate(candidate);
							return;
						}
						if (action.kind === "close") {
							setMention(null);
						}
					}}
				>
					{draft.prompt}
				</div>
				{menuOpen ? (
					<div
						aria-label="资源引用候选"
						className="resource-mention-menu"
						id={listboxId}
						role="listbox"
					>
						{candidates.map((candidate, index) => (
							<button
								aria-selected={index === activeIndex}
								className={index === activeIndex ? "active" : ""}
								id={`${listboxId}-option-${index}`}
								key={`${candidate.kind}:${candidate.nodeId ?? candidate.assetId}`}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => selectCandidate(candidate)}
								role="option"
								type="button"
							>
								<span>{candidate.label}</span>
								<small>
									{candidate.kind === "node" ? "画布连线节点" : "我的素材"}
								</small>
							</button>
						))}
						{assetList.status === "loading" && candidates.length === 0 ? (
							<p>正在查找可用素材…</p>
						) : null}
						{assetList.status !== "loading" && candidates.length === 0 ? (
							<p>没有可引用的资源。</p>
						) : null}
						{assetList.error ? <p>素材候选暂时无法载入。</p> : null}
						{assetList.nextCursor ? (
							<button
								className="resource-mention-more"
								disabled={assetList.status === "loading"}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() =>
									void requestAssets(assetList.nextCursor ?? undefined, true)
								}
								type="button"
							>
								加载更多素材候选
							</button>
						) : null}
					</div>
				) : null}
			</div>
			{draft.mentions.length > 0 ? (
				<ul aria-label="已引用资源" className="resource-mention-chips">
					{draft.mentions.map((item) => (
						<li key={`${item.kind}:${item.nodeId ?? item.assetId}`}>
							<span>@{item.label}</span>
							<button
								aria-label={`替换 ${item.label}`}
								disabled={disabled}
								onClick={() => replaceMention(item)}
								type="button"
							>
								替换
							</button>
							<button
								aria-label={`移除 ${item.label}`}
								disabled={disabled}
								onClick={() => removeMention(item)}
								onKeyDown={(event) => {
									if (event.key === "Backspace" || event.key === "Delete") {
										event.preventDefault();
										removeMention(item);
									}
								}}
								type="button"
							>
								移除
							</button>
						</li>
					))}
				</ul>
			) : (
				<p className="resource-composer-help">
					输入 @
					可引用已连接的媒体节点或服务端素材；未引用的资源不会进入生成请求。
				</p>
			)}
		</div>
	);
}

function editorPlainText(editor: HTMLElement): string {
	return (editor.textContent ?? "").replace(/\u00a0/gu, " ");
}

function editorSelectionOffsets(editor: HTMLElement): {
	end: number;
	start: number;
} {
	const fallback = editorPlainText(editor).length;
	const selection = window.getSelection();
	if (!selection?.rangeCount) return { end: fallback, start: fallback };
	const range = selection.getRangeAt(0);
	if (
		!editor.contains(range.startContainer) ||
		!editor.contains(range.endContainer)
	) {
		return { end: fallback, start: fallback };
	}
	return {
		end: selectionOffsetFromEditorStart(
			editor,
			range.endContainer,
			range.endOffset,
		),
		start: selectionOffsetFromEditorStart(
			editor,
			range.startContainer,
			range.startOffset,
		),
	};
}

function selectionOffsetFromEditorStart(
	editor: HTMLElement,
	container: Node,
	offset: number,
): number {
	const range = document.createRange();
	range.selectNodeContents(editor);
	try {
		range.setEnd(container, offset);
		return clampPlainTextSelection(
			editorPlainText(editor),
			range.toString().length,
		);
	} catch {
		return editorPlainText(editor).length;
	}
}

function setEditorSelection(editor: HTMLElement, offset: number) {
	const range = document.createRange();
	const target = clampPlainTextSelection(editorPlainText(editor), offset);
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
	let remaining = target;
	let lastTextNode: Text | null = null;
	let node = walker.nextNode();
	while (node) {
		const textNode = node as Text;
		lastTextNode = textNode;
		if (remaining <= textNode.data.length) {
			range.setStart(textNode, remaining);
			range.collapse(true);
			applyEditorSelection(range);
			return;
		}
		remaining -= textNode.data.length;
		node = walker.nextNode();
	}
	if (lastTextNode) {
		range.setStart(lastTextNode, lastTextNode.data.length);
	} else {
		range.setStart(editor, 0);
	}
	range.collapse(true);
	applyEditorSelection(range);
}

function applyEditorSelection(range: Range) {
	const selection = window.getSelection();
	if (!selection) return;
	selection.removeAllRanges();
	selection.addRange(range);
}

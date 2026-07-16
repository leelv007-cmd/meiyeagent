"use client";

import type {
	AdvancedCanvasProject,
	AdvancedCanvasRevision,
	CanvasGraph,
	CanvasOwnedAsset,
	LaunchCodeContext,
} from "@meiye/core/pro-studio";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	assetDeliveryUrl,
	CanvasBackendError,
	callCanvas as callCanvasRequest,
} from "./backend-client";
import {
	canvasCacheNamespace,
	clearSensitiveCanvasCaches,
} from "./cache-scope";
import {
	type CoreCanvasGenerationJob,
	generatedCanvasNode,
} from "./generation-ui-contract";
import { RuntimePanel } from "./runtime-panel";

interface CanvasShellProps {
	context: LaunchCodeContext;
	returnUrl: string;
}

const CANVAS_CACHE_SCHEMA_VERSION = 1;

export function CanvasShell({ context, returnUrl }: CanvasShellProps) {
	const [projects, setProjects] = useState<AdvancedCanvasProject[]>([]);
	const [assets, setAssets] = useState<CanvasOwnedAsset[]>([]);
	const [selected, setSelected] = useState<AdvancedCanvasProject | null>(null);
	const [revisions, setRevisions] = useState<AdvancedCanvasRevision[]>([]);
	const [adoptedNodeIds, setAdoptedNodeIds] = useState<string[]>([]);
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("正在恢复云端工程…");
	const fileRef = useRef<HTMLInputElement>(null);
	const selectedRef = useRef<AdvancedCanvasProject | null>(null);
	const dirtyRef = useRef(false);
	const draftSaveRef = useRef<Promise<AdvancedCanvasProject> | null>(null);
	const inFlightAbortRef = useRef<AbortController | null>(
		new AbortController(),
	);
	const callCanvas = useCallback(
		<T,>(
			action: Parameters<typeof callCanvasRequest>[0],
			input: Record<string, unknown> = {},
			options: Parameters<typeof callCanvasRequest>[2] = {},
		) =>
			callCanvasRequest<T>(action, input, {
				...options,
				signal: inFlightAbortRef.current?.signal,
			}),
		[],
	);
	const cacheNamespace = canvasCacheNamespace({
		schemaVersion: CANVAS_CACHE_SCHEMA_VERSION,
		userId: context.userId,
		workspaceId: context.workspaceId,
	});
	const persistSelectedDraft = useCallback(
		async function persistDraft(): Promise<AdvancedCanvasProject | null> {
			if (draftSaveRef.current) {
				await draftSaveRef.current;
				return dirtyRef.current ? persistDraft() : selectedRef.current;
			}
			const snapshot = selectedRef.current;
			if (!snapshot || !dirtyRef.current) return snapshot;
			const saving = callCanvas<AdvancedCanvasProject>("saveProjectDraft", {
				expectedDraftVersion: snapshot.draftVersion,
				graph: snapshot.graph,
				projectId: snapshot.id,
			});
			draftSaveRef.current = saving;
			try {
				const saved = await saving;
				const current = selectedRef.current;
				if (!current || current.id !== snapshot.id) return saved;
				if (current === snapshot) {
					selectedRef.current = saved;
					setSelected(saved);
					dirtyRef.current = false;
					setDirty(false);
					return saved;
				}
				const rebased = {
					...current,
					draftVersion: saved.draftVersion,
					updatedAt: saved.updatedAt,
				};
				selectedRef.current = rebased;
				setSelected(rebased);
				return saved;
			} finally {
				draftSaveRef.current = null;
			}
		},
		[callCanvas],
	);

	const refresh = useCallback(async () => {
		const [nextProjects, nextAssets] = await Promise.all([
			callCanvas<AdvancedCanvasProject[]>("listProjects"),
			callCanvas<CanvasOwnedAsset[]>("listAssets"),
		]);
		setProjects(nextProjects);
		setAssets(nextAssets);
		setMessage(
			nextProjects.length ? "工程已从云端恢复" : "创建第一个高阶画布工程",
		);
	}, [callCanvas]);

	useEffect(() => {
		refresh().catch(showError(setMessage));
	}, [refresh]);

	useEffect(() => {
		const previous = window.sessionStorage.getItem("canvas-cache-namespace");
		window.sessionStorage.setItem("canvas-cache-namespace", cacheNamespace);
		if (previous && previous !== cacheNamespace) {
			void clearSensitiveCanvasCaches(
				createCacheCleanupPorts(inFlightAbortRef),
			);
		}
		return () => {
			// Identity-bound cleanup when the shell unmounts (logout / workspace switch).
			void clearSensitiveCanvasCaches(
				createCacheCleanupPorts(inFlightAbortRef),
			);
		};
	}, [cacheNamespace]);

	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);

	useEffect(() => {
		if (!dirty || !selected) return;
		const timer = window.setTimeout(() => {
			persistSelectedDraft()
				.then((saved) => {
					if (saved) setMessage(`草稿 v${saved.draftVersion} 已自动保存`);
				})
				.catch(showError(setMessage));
		}, 1200);
		return () => window.clearTimeout(timer);
	}, [dirty, selected, persistSelectedDraft]);

	async function createProject() {
		const name = window.prompt("工程名称", "新高阶画布");
		if (!name) return;
		await run(async () => {
			const project = await callCanvas<AdvancedCanvasProject>("createProject", {
				graph: emptyGraph(),
				name,
			});
			await refresh();
			await openProject(project.id);
		}, "工程已创建");
	}

	async function openProject(projectId: string) {
		await run(async () => {
			const [project, history] = await Promise.all([
				callCanvas<AdvancedCanvasProject>("loadProject", { projectId }),
				callCanvas<AdvancedCanvasRevision[]>("listRevisions", { projectId }),
			]);
			selectedRef.current = project;
			setSelected(project);
			setRevisions(history);
			dirtyRef.current = false;
			setDirty(false);
		}, "工程已加载");
	}

	async function renameProject() {
		if (!selected) return;
		const name = window.prompt("新名称", selected.name);
		if (!name) return;
		await run(async () => {
			const project = await callCanvas<AdvancedCanvasProject>("renameProject", {
				name,
				projectId: selected.id,
			});
			selectedRef.current = project;
			setSelected(project);
			await refresh();
		}, "工程已重命名");
	}

	async function duplicateProject() {
		if (!selected) return;
		await run(async () => {
			const copy = await callCanvas<AdvancedCanvasProject>("duplicateProject", {
				name: `${selected.name} 副本`,
				projectId: selected.id,
			});
			await refresh();
			await openProject(copy.id);
		}, "已复制当前草稿");
	}

	async function deleteProject() {
		if (!selected || !window.confirm(`将“${selected.name}”移入回收保留区？`))
			return;
		await run(async () => {
			await callCanvas("deleteProject", { projectId: selected.id });
			selectedRef.current = null;
			setSelected(null);
			setRevisions([]);
			dirtyRef.current = false;
			setDirty(false);
			await refresh();
		}, "工程已软删除");
	}

	async function saveDraft() {
		const saved = await persistSelectedDraft();
		if (saved) setMessage(`草稿 v${saved.draftVersion} 已保存`);
	}

	function addTextNode() {
		if (!selected) return;
		const graph = structuredClone(selected.graph);
		graph.nodes.push({
			data: { text: "双击后续编辑这段文案" },
			id: `text-${crypto.randomUUID()}`,
			type: "text",
		});
		const changed = { ...selected, graph };
		selectedRef.current = changed;
		setSelected(changed);
		dirtyRef.current = true;
		setDirty(true);
	}

	async function checkpoint() {
		if (!selected) return;
		await run(async () => {
			while (dirtyRef.current) await persistSelectedDraft();
			const current = selectedRef.current;
			if (!current) return;
			await callCanvas("createCheckpoint", {
				expectedDraftVersion: current.draftVersion,
				label: `检查点 ${new Date().toLocaleString()}`,
				projectId: current.id,
			});
			setRevisions(
				await callCanvas<AdvancedCanvasRevision[]>("listRevisions", {
					projectId: current.id,
				}),
			);
		}, "不可变检查点已创建");
	}

	async function restore(revisionId: string) {
		if (!selected || !window.confirm("以此检查点内容开启一个新草稿？")) return;
		await run(async () => {
			const restored = await callCanvas<AdvancedCanvasProject>(
				"restoreRevision",
				{
					expectedDraftVersion: selected.draftVersion,
					projectId: selected.id,
					revisionId,
				},
			);
			selectedRef.current = restored;
			setSelected(restored);
			dirtyRef.current = false;
			setDirty(false);
		}, "检查点已恢复为新草稿");
	}

	async function upload(file: File) {
		await run(async () => {
			const bytesBase64 = await fileBase64(file);
			await callCanvas("persistLocalCanvasArtifact", {
				bytesBase64,
				contentType: file.type,
				derivation: "retouch",
				fileName: file.name,
			});
			setAssets(await callCanvas<CanvasOwnedAsset[]>("listAssets"));
		}, "素材已存入服务端素材库");
	}

	function insertAsset(asset: CanvasOwnedAsset) {
		if (!selected) return;
		const graph = structuredClone(selected.graph);
		graph.nodes.push({
			data: { assetId: asset.id },
			id: `image-${crypto.randomUUID()}`,
			type: "image",
		});
		const changed = { ...selected, graph };
		selectedRef.current = changed;
		setSelected(changed);
		dirtyRef.current = true;
		setDirty(true);
	}

	function insertGenerated(job: CoreCanvasGenerationJob) {
		const generated = generatedCanvasNode(job);
		if (!selected || !generated) return;
		const graph = structuredClone(selected.graph);
		if (graph.nodes.some((node) => node.data.jobId === job.jobId)) {
			setMessage("该生成结果已在画布中");
			return;
		}
		graph.nodes.push({
			data: generated.data,
			id: `generated-${crypto.randomUUID()}`,
			type: generated.type,
		});
		const changed = { ...selected, graph };
		selectedRef.current = changed;
		setSelected(changed);
		dirtyRef.current = true;
		setDirty(true);
		setMessage("生成结果已插入画布，请保存或创建检查点");
	}

	async function run(action: () => Promise<void>, success: string) {
		setBusy(true);
		try {
			await action();
			setMessage(success);
		} catch (error) {
			showError(setMessage)(error);
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="studio-shell">
			<header className="studio-topbar">
				<div>
					<span className="studio-mark">Pro Studio</span>
					<span className="workspace-name">工作区 {context.workspaceId}</span>
				</div>
				<div className="topbar-actions">
					<span className="status-dot" aria-live="polite">
						{message}
					</span>
					<span>{context.bootstrap?.locale ?? "zh-CN"}</span>
					<span>主题 {context.bootstrap?.theme ?? "system"}</span>
					<a
						className="return-link"
						href={returnUrl}
						onClick={() => {
							void clearSensitiveCanvasCaches(
								createCacheCleanupPorts(inFlightAbortRef),
							);
						}}
					>
						返回主产品
					</a>
				</div>
			</header>
			<div className="studio-body">
				<aside className="project-rail">
					<div className="rail-heading">
						<h1>画布工程</h1>
						<button type="button" onClick={createProject} disabled={busy}>
							新建
						</button>
					</div>
					<div className="project-list">
						{projects.map((project) => (
							<button
								className={
									selected?.id === project.id
										? "project-card active"
										: "project-card"
								}
								key={project.id}
								onClick={() => openProject(project.id)}
								type="button"
							>
								<strong>{project.name}</strong>
								<small>草稿 v{project.draftVersion}</small>
							</button>
						))}
					</div>
					<div className="asset-library">
						<div className="rail-heading">
							<h2>素材库</h2>
							<button type="button" onClick={() => fileRef.current?.click()}>
								上传
							</button>
							<input
								ref={fileRef}
								hidden
								type="file"
								accept="image/png,image/jpeg,image/webp"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) upload(file);
									event.currentTarget.value = "";
								}}
							/>
						</div>
						<div className="asset-grid">
							{assets.map((asset) => (
								<button
									key={asset.id}
									type="button"
									onClick={() => insertAsset(asset)}
									title={asset.fileName}
								>
									{asset.contentType.startsWith("image/") ? (
										// The authenticated facade is the only media URL exposed to the browser.
										// biome-ignore lint/performance/noImgElement: private asset delivery is not an image optimizer source.
										<img
											src={assetDeliveryUrl(asset.id)}
											alt={asset.fileName}
										/>
									) : (
										<span>{asset.contentType}</span>
									)}
								</button>
							))}
						</div>
					</div>
				</aside>
				<section className="canvas-stage">
					{selected ? (
						<>
							<div className="canvas-toolbar">
								<strong>{selected.name}</strong>
								<span>
									草稿 v{selected.draftVersion}
									{dirty ? " · 未保存" : ""}
								</span>
								<button type="button" onClick={addTextNode}>
									文字节点
								</button>
								<button
									type="button"
									onClick={() => saveDraft()}
									disabled={!dirty || busy}
								>
									保存
								</button>
								<button type="button" onClick={checkpoint} disabled={busy}>
									检查点
								</button>
								<button type="button" onClick={renameProject}>
									重命名
								</button>
								<button type="button" onClick={duplicateProject}>
									复制
								</button>
								<button
									className="danger"
									type="button"
									onClick={deleteProject}
								>
									删除
								</button>
							</div>
							<section
								className="infinite-canvas"
								aria-label="Pro Studio 高阶画布"
							>
								{selected.graph.nodes.length === 0 ? (
									<div className="canvas-empty">
										<strong>从素材或文字节点开始</strong>
										<p>工程图与媒体都保存在服务端，换设备后仍可恢复。</p>
									</div>
								) : (
									selected.graph.nodes.map((node, index) => (
										<article
											className={
												adoptedNodeIds.includes(node.id)
													? "canvas-node adopted"
													: "canvas-node"
											}
											key={node.id}
											style={{
												left: 80 + (index % 3) * 260,
												top: 90 + Math.floor(index / 3) * 230,
											}}
										>
											<span>{node.type}</span>
											{typeof node.data.assetId === "string" &&
											node.type === "video" ? (
												<>
													{/* biome-ignore lint/a11y/useMediaCaption: generated media has no server-authored caption track. */}
													<video
														controls
														preload="metadata"
														src={assetDeliveryUrl(node.data.assetId)}
													/>
													<a
														download
													href={assetDeliveryUrl(node.data.assetId)}
													>
														下载视频
													</a>
												</>
											) : typeof node.data.assetId === "string" &&
												node.type === "audio" ? (
												<>
													{/* biome-ignore lint/a11y/useMediaCaption: generated media has no server-authored caption track. */}
													<audio
														controls
														preload="metadata"
														src={assetDeliveryUrl(node.data.assetId)}
													/>
													<a
														download
													href={assetDeliveryUrl(node.data.assetId, {
														download: true,
													})}
													>
														下载音频
													</a>
												</>
											) : typeof node.data.assetId === "string" ? (
												// biome-ignore lint/performance/noImgElement: authenticated binary facade.
												<img
													src={assetDeliveryUrl(node.data.assetId)}
													alt="画布素材节点"
												/>
											) : (
												<p>
													{typeof node.data.text === "string"
														? node.data.text
														: node.id}
												</p>
											)}
											{adoptedNodeIds.includes(node.id) ? (
												<small>已采用</small>
											) : null}
										</article>
									))
								)}
							</section>
							<div className="revision-strip">
								<strong>检查点</strong>
								{revisions.length === 0 ? (
									<span>尚无检查点</span>
								) : (
									revisions.map((revision) => (
										<button
											key={revision.id}
											type="button"
											onClick={() => restore(revision.id)}
										>
											{revision.label ?? `v${revision.draftVersion}`}
										</button>
									))
								)}
							</div>
						</>
					) : (
						<div className="welcome-panel">
							<span>高阶工作台</span>
							<h2>把复杂创作过程留在一张可恢复的画布上</h2>
							<p>
								新建或选择工程。当前壳不包含上游账户、积分、退出或管理员入口。
							</p>
							<button type="button" onClick={createProject}>
								新建工程
							</button>
						</div>
					)}
				</section>
				<RuntimePanel
					mainReturnUrl={returnUrl}
					onAdoptedNodesChange={setAdoptedNodeIds}
					onInsertGenerated={insertGenerated}
					onReloadProject={openProject}
					persistDraft={persistSelectedDraft}
					project={selected}
					requestAbortRef={inFlightAbortRef}
					revisions={revisions}
				/>
			</div>
		</main>
	);
}

function emptyGraph(): CanvasGraph {
	return { edges: [], nodes: [], schemaVersion: 1 };
}

function createCacheCleanupPorts(inFlightAbortRef: {
	current: AbortController | null;
}) {
	return {
		abortInFlight() {
			inFlightAbortRef.current?.abort();
			inFlightAbortRef.current = new AbortController();
		},
		broadcastLogout() {
			try {
				if (typeof BroadcastChannel !== "undefined") {
					const channel = new BroadcastChannel("canvas-session");
					channel.postMessage({ type: "logout" });
					channel.close();
				}
			} catch {
				// Best-effort broadcast; cleanup continues.
			}
		},
		async clearBlobCache() {
			if (typeof caches === "undefined") return;
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key.startsWith("canvas:"))
					.map((key) => caches.delete(key)),
			);
		},
		async clearIndexedDb() {
			if (typeof indexedDB === "undefined" || !indexedDB.databases) return;
			const databases = await indexedDB.databases();
			await Promise.all(
				databases
					.map((db) => db.name)
					.filter(
						(name): name is string => name?.startsWith("canvas:") === true,
					)
					.map(
						(name) =>
							new Promise<void>((resolve) => {
								const request = indexedDB.deleteDatabase(name);
								request.onsuccess = () => resolve();
								request.onerror = () => resolve();
								request.onblocked = () => resolve();
							}),
					),
			);
		},
		async clearLocalForage() {
			try {
				window.localStorage.removeItem("canvas-local-draft");
				window.sessionStorage.removeItem("canvas-local-draft");
			} catch {
				// Storage may be unavailable in private mode.
			}
		},
	};
}

function showError(setMessage: (message: string) => void) {
	return (error: unknown) => {
		if (error instanceof CanvasBackendError) {
			setMessage(
				error.code === "DRAFT_VERSION_CONFLICT"
					? "草稿已在另一处更新，请重新加载后再保存"
					: error.message,
			);
			return;
		}
		setMessage("操作失败，请重试");
	};
}

async function fileBase64(file: File) {
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

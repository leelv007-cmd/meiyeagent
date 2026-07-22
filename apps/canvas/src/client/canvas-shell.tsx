"use client";

import type {
	AdvancedCanvasProject,
	AdvancedCanvasRevision,
	CanvasOwnedAsset,
	LaunchCodeContext,
} from "@meiye/core/pro-studio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setCanvasTheme } from "@/stores/use-theme-store";
import {
	emptyKernelGraph,
	fromKernelGraph,
	type KernelSessionGraph,
	toKernelGraph,
} from "../kernel-host/graph-bridge";
import { KernelCanvasSurface } from "../kernel-host/kernel-canvas-surface";
import {
	fileToBase64,
	persistBlobAsOwnedAsset,
} from "../kernel-host/media-adapter";
import {
	createCanvasSessionState,
	withCanvasViewport,
	withSelectedCanvasNodes,
} from "../kernel-host/ported/canvas-session-store";
import {
	DraftVersionConflictError,
	ProjectPersistenceAdapter,
} from "../kernel-host/project-persistence";
import { cropOwnedImageAsset } from "../kernel-host/retouch-adapter";
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
	applyAndPersistKernelGraph,
	applyCanvasBootstrapAppearance,
	kernelInsertPosition,
	projectIdFromAudience,
	runAfterDirtyDraftFlush,
	warnBeforeCanvasUnload,
} from "./canvas-shell-coordinator";
import {
	type CoreCanvasGenerationJob,
	canvasNodeTypeFromContentType,
	generatedCanvasNode,
	generatedResultEdges,
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
	const [canvasSession, setCanvasSession] = useState(createCanvasSessionState);
	const [kernelGraph, setKernelGraph] = useState<KernelSessionGraph | null>(
		null,
	);
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("正在恢复云端工程…");
	const selectedNodeIds = canvasSession.selectedNodeIds;
	const setSelectedNodeIds = useCallback((ids: string[]) => {
		setCanvasSession((current) => withSelectedCanvasNodes(current, ids));
	}, []);
	const fileRef = useRef<HTMLInputElement>(null);
	const assetLibraryRef = useRef<HTMLDivElement>(null);
	const selectedRef = useRef<AdvancedCanvasProject | null>(null);
	const dirtyRef = useRef(false);
	const kernelGraphRef = useRef<KernelSessionGraph | null>(null);
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
	const projectPersistence = useMemo(
		() => new ProjectPersistenceAdapter(callCanvas),
		[callCanvas],
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
			const kernel = kernelGraphRef.current ?? toKernelGraph(snapshot.graph);
			const saving = projectPersistence.saveDraft(
				snapshot.id,
				snapshot.draftVersion,
				kernel,
			);
			draftSaveRef.current = saving;
			try {
				const saved = await saving;
				const current = selectedRef.current;
				if (!current || current.id !== snapshot.id) return saved;
				if (current === snapshot) {
					selectedRef.current = saved;
					setSelected(saved);
					const nextKernel = toKernelGraph(
						saved.graph,
						kernelGraphRef.current?.viewport,
					);
					kernelGraphRef.current = nextKernel;
					setKernelGraph(nextKernel);
					dirtyRef.current = false;
					setDirty(false);
					return saved;
				}
				const rebased = {
					...current,
					draftVersion: saved.draftVersion,
					graph: fromKernelGraph(
						kernelGraphRef.current ?? toKernelGraph(current.graph),
					),
					updatedAt: saved.updatedAt,
				};
				selectedRef.current = rebased;
				setSelected(rebased);
				return saved;
			} finally {
				draftSaveRef.current = null;
			}
		},
		[projectPersistence],
	);

	const refresh = useCallback(async () => {
		const [nextProjects, nextAssets] = await Promise.all([
			projectPersistence.listProjects(),
			callCanvas<CanvasOwnedAsset[]>("listAssets"),
		]);
		setProjects(nextProjects);
		setAssets(nextAssets);
		setMessage(
			nextProjects.length ? "工程已从云端恢复" : "创建第一个高阶画布工程",
		);
		return nextProjects;
	}, [callCanvas, projectPersistence]);

	const loadProjectIntoShell = useCallback(
		async (projectId: string) => {
			const loaded = await projectPersistence.loadProject(projectId);
			selectedRef.current = loaded.project;
			setSelected(loaded.project);
			kernelGraphRef.current = loaded.kernel;
			setKernelGraph(loaded.kernel);
			setCanvasSession(
				createCanvasSessionState({ viewport: loaded.kernel.viewport }),
			);
			setSelectedNodeIds([]);
			setRevisions(loaded.revisions);
			dirtyRef.current = false;
			setDirty(false);
			return loaded.project;
		},
		[projectPersistence, setSelectedNodeIds],
	);

	useEffect(() => {
		const bootstrapProjectId = projectIdFromAudience(context.audience);
		refresh()
			.then(async () => {
				if (!bootstrapProjectId) return;
				await loadProjectIntoShell(bootstrapProjectId);
				setMessage("工程已加载");
			})
			.catch(showError(setMessage));
	}, [context.audience, loadProjectIntoShell, refresh]);

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		return applyCanvasBootstrapAppearance(context.bootstrap, {
			applyLanguage(locale) {
				document.documentElement.lang = locale;
			},
			applyTheme(theme) {
				setCanvasTheme(theme);
				document.documentElement.dataset.canvasTheme = theme;
				document.documentElement.style.colorScheme = theme;
			},
			prefersDark: () => media.matches,
			subscribeToSystemTheme(listener) {
				media.addEventListener("change", listener);
				return () => media.removeEventListener("change", listener);
			},
		});
	}, [context.bootstrap]);

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
		const warn = (event: BeforeUnloadEvent) =>
			warnBeforeCanvasUnload(dirtyRef.current, event);
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

	const flushDirtyDraft = useCallback(async () => {
		while (dirtyRef.current) await persistSelectedDraft();
	}, [persistSelectedDraft]);

	async function createProject() {
		const name = window.prompt("工程名称", "新高阶画布");
		if (!name) return;
		await run(async () => {
			await runAfterDirtyDraftFlush({
				action: async () => {
					const project = await projectPersistence.createProject(
						name,
						emptyKernelGraph(),
					);
					await refresh();
					await loadProjectIntoShell(project.id);
				},
				flushDraft: flushDirtyDraft,
				isDirty: () => dirtyRef.current,
			});
		}, "工程已创建");
	}

	async function openProject(projectId: string) {
		await run(async () => {
			await runAfterDirtyDraftFlush({
				action: () => loadProjectIntoShell(projectId),
				flushDraft: flushDirtyDraft,
				isDirty: () => dirtyRef.current,
			});
		}, "工程已加载");
	}

	function applyKernelGraph(next: KernelSessionGraph) {
		if (!selectedRef.current) return;
		kernelGraphRef.current = next;
		setKernelGraph(next);
		const project = {
			...selectedRef.current,
			graph: fromKernelGraph(next),
		};
		selectedRef.current = project;
		setSelected(project);
		dirtyRef.current = true;
		setDirty(true);
	}

	function applyKernelViewport(viewport: KernelSessionGraph["viewport"]) {
		const current = kernelGraphRef.current;
		if (!current) return;
		const next = { ...current, viewport };
		kernelGraphRef.current = next;
		setKernelGraph(next);
		setCanvasSession((session) => withCanvasViewport(session, viewport));
	}

	async function renameProject() {
		if (!selected) return;
		const name = window.prompt("新名称", selected.name);
		if (!name) return;
		await run(async () => {
			await runAfterDirtyDraftFlush({
				action: async () => {
					const current = selectedRef.current;
					if (!current) return;
					const project = await projectPersistence.renameProject(
						current.id,
						name,
					);
					selectedRef.current = project;
					setSelected(project);
					await refresh();
				},
				flushDraft: flushDirtyDraft,
				isDirty: () => dirtyRef.current,
			});
		}, "工程已重命名");
	}

	async function duplicateProject() {
		if (!selected) return;
		await run(async () => {
			await runAfterDirtyDraftFlush({
				action: async () => {
					const current = selectedRef.current;
					if (!current) return;
					const copy = await projectPersistence.duplicateProject(
						current.id,
						`${current.name} 副本`,
					);
					await refresh();
					await loadProjectIntoShell(copy.id);
				},
				flushDraft: flushDirtyDraft,
				isDirty: () => dirtyRef.current,
			});
		}, "已复制当前草稿");
	}

	async function deleteProject() {
		if (!selected || !window.confirm(`将“${selected.name}”移入回收保留区？`))
			return;
		await run(async () => {
			await runAfterDirtyDraftFlush({
				action: async () => {
					const current = selectedRef.current;
					if (!current) return;
					await projectPersistence.deleteProject(current.id);
					selectedRef.current = null;
					setSelected(null);
					kernelGraphRef.current = null;
					setKernelGraph(null);
					setSelectedNodeIds([]);
					setRevisions([]);
					dirtyRef.current = false;
					setDirty(false);
					await refresh();
				},
				flushDraft: flushDirtyDraft,
				isDirty: () => dirtyRef.current,
			});
		}, "工程已软删除");
	}

	async function saveDraft() {
		const saved = await persistSelectedDraft();
		if (saved) setMessage(`草稿 v${saved.draftVersion} 已保存`);
	}

	function addTextNode() {
		if (!selected || !kernelGraphRef.current) return;
		const next = structuredClone(kernelGraphRef.current);
		const position = kernelInsertPosition(next.nodes.length);
		next.nodes.push({
			data: { text: "双击后续编辑这段文案" },
			height: 120,
			id: `text-${crypto.randomUUID()}`,
			type: "text",
			width: 220,
			...position,
		});
		applyKernelGraph(next);
	}

	async function checkpoint() {
		if (!selected) return;
		await run(async () => {
			while (dirtyRef.current) await persistSelectedDraft();
			const current = selectedRef.current;
			if (!current) return;
			await projectPersistence.createCheckpoint({
				expectedDraftVersion: current.draftVersion,
				label: `检查点 ${new Date().toLocaleString()}`,
				projectId: current.id,
			});
			setRevisions(await projectPersistence.listRevisions(current.id));
		}, "不可变检查点已创建");
	}

	async function restore(revisionId: string) {
		if (!selected || !window.confirm("以此检查点内容开启一个新草稿？")) return;
		await run(async () => {
			const current = selectedRef.current;
			if (!current) return;
			const restored = await projectPersistence.restoreRevision({
				expectedDraftVersion: current.draftVersion,
				projectId: current.id,
				revisionId,
			});
			selectedRef.current = restored;
			setSelected(restored);
			const nextKernel = toKernelGraph(restored.graph);
			kernelGraphRef.current = nextKernel;
			setKernelGraph(nextKernel);
			setSelectedNodeIds([]);
			dirtyRef.current = false;
			setDirty(false);
		}, "检查点已恢复为新草稿");
	}

	async function upload(file: File) {
		await run(async () => {
			const persisted = await persistBlobAsOwnedAsset(callCanvas, {
				bytesBase64: await fileToBase64(file),
				contentType: file.type,
				derivation: "retouch",
				fileName: file.name,
			});
			insertOwnedAsset(persisted);
			setAssets(await callCanvas<CanvasOwnedAsset[]>("listAssets"));
		}, "素材已存入服务端素材库并插入画布");
	}

	function insertAsset(asset: CanvasOwnedAsset) {
		insertOwnedAsset(asset);
	}

	function insertOwnedAsset(asset: { contentType: string; id: string }) {
		if (!selected || !kernelGraphRef.current) return;
		const nodeType = canvasNodeTypeFromContentType(asset.contentType);
		if (!nodeType) {
			setMessage("该素材类型暂不能插入画布");
			return;
		}
		const next = structuredClone(kernelGraphRef.current);
		const position = kernelInsertPosition(next.nodes.length);
		next.nodes.push({
			data: { assetId: asset.id },
			height: 160,
			id: `${nodeType}-${crypto.randomUUID()}`,
			type: nodeType,
			width: 200,
			...position,
		});
		applyKernelGraph(next);
	}

	async function importFiles(
		files: File[],
		position: { x: number; y: number },
	) {
		if (!selected || !kernelGraphRef.current || files.length === 0) return;
		await run(async () => {
			const next = structuredClone(kernelGraphRef.current);
			if (!next) return;
			const insertedIds: string[] = [];
			for (const [index, file] of files.entries()) {
				const nodeType = canvasNodeTypeFromContentType(file.type);
				if (!nodeType) continue;
				const asset = await persistBlobAsOwnedAsset(callCanvas, {
					bytesBase64: await fileToBase64(file),
					contentType: file.type,
					fileName: file.name || `clipboard-${index + 1}`,
				});
				const id = `${nodeType}-${crypto.randomUUID()}`;
				next.nodes.push({
					data: { assetId: asset.id },
					height: 160,
					id,
					type: nodeType,
					width: 200,
					x: position.x + index * 32,
					y: position.y + index * 32,
				});
				insertedIds.push(id);
			}
			if (insertedIds.length === 0) return;
			applyKernelGraph(next);
			setSelectedNodeIds(insertedIds);
			setAssets(await callCanvas<CanvasOwnedAsset[]>("listAssets"));
		}, "素材已持久化并插入画布");
	}

	async function cropSelectedImage(nodeId: string) {
		await run(async () => {
			const current = kernelGraphRef.current;
			const sourceNode = current?.nodes.find((node) => node.id === nodeId);
			if (!current || !sourceNode)
				throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
			const derived = await cropOwnedImageAsset(callCanvas, { sourceNode });
			const next = structuredClone(current);
			next.nodes.push(derived.node);
			next.edges.push(derived.edge);
			setSelectedNodeIds([derived.node.id]);
			await applyAndPersistKernelGraph({
				applyGraph: applyKernelGraph,
				graph: next,
				persistDraft: persistSelectedDraft,
			});
			setAssets(await callCanvas<CanvasOwnedAsset[]>("listAssets"));
		}, "裁切结果已生成并保存");
	}

	async function insertGenerated(
		job: CoreCanvasGenerationJob,
		inputNodeIds: string[],
	) {
		const generated = generatedCanvasNode(job);
		if (
			!selected ||
			job.projectId !== selected.id ||
			!generated ||
			!kernelGraphRef.current
		)
			return;
		if (
			kernelGraphRef.current.nodes.some((node) => node.data.jobId === job.jobId)
		) {
			setMessage("该生成结果已在画布中");
			return;
		}
		await run(async () => {
			const current = kernelGraphRef.current;
			if (!current) return;
			const next = structuredClone(current);
			const position = kernelInsertPosition(next.nodes.length);
			const resultNodeId = `generated-${crypto.randomUUID()}`;
			next.nodes.push({
				data: generated.data,
				height: 160,
				id: resultNodeId,
				type: generated.type,
				width: 200,
				...position,
			});
			next.edges.push(
				...generatedResultEdges({
					existingEdges: next.edges,
					inputNodeIds,
					resultNodeId,
				}),
			);
			setSelectedNodeIds([resultNodeId]);
			await applyAndPersistKernelGraph({
				applyGraph: applyKernelGraph,
				graph: next,
				persistDraft: persistSelectedDraft,
			});
		}, "生成结果已插入画布并保存");
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
					<span className="workspace-name">当前工作区</span>
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
					<div className="asset-library" ref={assetLibraryRef}>
						<div className="rail-heading">
							<h2>素材库</h2>
							<button type="button" onClick={() => fileRef.current?.click()}>
								上传
							</button>
							<input
								ref={fileRef}
								hidden
								type="file"
								accept="image/*,video/*,audio/*"
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
								className="infinite-canvas kernel-stage"
								aria-label="Pro Studio 高阶画布"
							>
								{kernelGraph ? (
									<KernelCanvasSurface
										key={selected.id}
										adoptedNodeIds={adoptedNodeIds}
										graph={kernelGraph}
										onChange={applyKernelGraph}
										onCropSelected={cropSelectedImage}
										onImportFiles={importFiles}
										onOpenAssets={() =>
											assetLibraryRef.current?.scrollIntoView({
												behavior: "smooth",
												block: "nearest",
											})
										}
										onSelectNodes={setSelectedNodeIds}
										onUpload={() => fileRef.current?.click()}
										onViewportChange={applyKernelViewport}
										selectedNodeIds={selectedNodeIds}
									/>
								) : null}
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
					key={selected?.id ?? "no-project"}
					graph={kernelGraph}
					mainReturnUrl={returnUrl}
					onAdoptedNodesChange={setAdoptedNodeIds}
					onInsertGenerated={insertGenerated}
					onReloadProject={openProject}
					persistDraft={persistSelectedDraft}
					project={selected}
					requestAbortRef={inFlightAbortRef}
					revisions={revisions}
					selectedNodeIds={selectedNodeIds}
				/>
			</div>
		</main>
	);
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
		if (
			error instanceof CanvasBackendError ||
			error instanceof DraftVersionConflictError
		) {
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

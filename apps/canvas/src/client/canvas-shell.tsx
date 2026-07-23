"use client";

import type {
	AdvancedCanvasProject,
	AdvancedCanvasRevision,
	LaunchCodeContext,
} from "@meiye/core/pro-studio";
import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";
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
import {
	cropOwnedImageAsset,
	loadSourceImageDataUrl,
	persistMaskOwnedImageAsset,
	splitOwnedImageAsset,
	upscaleOwnedImageAsset,
} from "../kernel-host/retouch-adapter";
import {
	type RetouchAngleDialogParams,
	type RetouchCropRect,
	type RetouchDialogRequest,
	RetouchDialogs,
	type RetouchMaskEditPayload,
	RetouchQuoteDialog,
	type RetouchSplitParams,
	type RetouchUpscaleParams,
} from "../kernel-host/retouch-dialogs";
import {
	activeRetouchCapability,
	buildRetouchGenerationInput,
	isReversePromptConfigNode,
	type RetouchGenerationCapability,
	type RetouchGenerationKind,
	retouchGenerationLabel,
	reversePromptConfigData,
} from "../kernel-host/retouch-generation";
import {
	CanvasBackendError,
	callCanvas as callCanvasRequest,
} from "./backend-client";
import {
	canvasCacheNamespace,
	clearSensitiveCanvasCaches,
} from "./cache-scope";

import { downloadCanvasExport } from "./canvas-export-client";
import {
	applyAndPersistKernelGraph,
	applyCanvasBootstrapAppearance,
	kernelInsertPosition,
	projectIdFromAudience,
	runAfterDirtyDraftFlush,
	warnBeforeCanvasUnload,
} from "./canvas-shell-coordinator";
import {
	type CanvasTextStreamEvent,
	streamCanvasTextGeneration,
} from "./canvas-text-stream";
import {
	type CanvasGenerationRequest,
	type CoreCanvasGenerationJob,
	type CoreCanvasGenerationQuote,
	canvasGenerationSubmitPayload,
	canvasNodeTypeFromContentType,
	generatedCanvasNode,
	generatedResultEdges,
} from "./generation-ui-contract";
import {
	type CanvasGenerationBackendRequest,
	type CanvasGenerationCatalog,
	type CanvasGenerationContextNodeKind,
	defaultCanvasNodeGenerationOperation,
	reconcileCanvasGenerationBatchJobs,
} from "./node-generation-contract";
import {
	CANVAS_NODE_GENERATION_STATE_KEY,
	type CanvasNodeGenerationState,
	type CanvasTextStreamProgress,
	removeCanvasTextStreamProgress,
	restoreCanvasNodeGenerationState,
	serializeCanvasNodeGenerationState,
	upsertCanvasTextStreamProgress,
} from "./node-generation-persistence";
import {
	type CanvasNodeGenerationSubmittedItem,
	CanvasNodeGenerationWorkbench,
} from "./node-generation-workbench";
import {
	CanvasExportDialog,
	DeleteProjectsDialog,
	ProjectNameDialog,
	RestoreRevisionDialog,
} from "./project-dialogs";
import {
	merchantSafeWorkspaceDisplayName,
	projectCardMetadata,
	selectedProjectsForDeletion,
	toggleProjectSelection,
	WORKSPACE_DISPLAY_FALLBACK,
} from "./project-journey";
import {
	type CanvasAssetListItem,
	type CanvasCursorPage,
	nodeMentionCandidates,
	type ResourceDraft,
	resourceKindFromContentType,
	serializeResourceDraft,
	validateCanvasUpload,
} from "./resource-workflow";
import { CanvasAssetPicker } from "./resource-workflow-ui";
import { RuntimePanel } from "./runtime-panel";

interface CanvasShellProps {
	context: LaunchCodeContext;
	returnUrl: string;
}

const CANVAS_CACHE_SCHEMA_VERSION = 1;

type RetouchCatalog = {
	operations: RetouchGenerationCapability[];
};

export function CanvasShell({ context, returnUrl }: CanvasShellProps) {
	const [projects, setProjects] = useState<AdvancedCanvasProject[]>([]);
	const [projectLoadState, setProjectLoadState] = useState<
		"error" | "loading" | "ready"
	>("loading");
	const [selected, setSelected] = useState<AdvancedCanvasProject | null>(null);
	const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
	const [revisions, setRevisions] = useState<AdvancedCanvasRevision[]>([]);
	const [workspaceDisplayName, setWorkspaceDisplayName] = useState(
		WORKSPACE_DISPLAY_FALLBACK,
	);
	const [projectNameDialog, setProjectNameDialog] = useState<{
		initialName: string;
		mode: "create" | "rename";
		projectId?: string;
	} | null>(null);
	const [deletingProjectIds, setDeletingProjectIds] = useState<string[] | null>(
		null,
	);
	const [restoreRevisionId, setRestoreRevisionId] = useState<string | null>(
		null,
	);
	const [exportDialog, setExportDialog] = useState<{
		project: AdvancedCanvasProject;
		revisions: AdvancedCanvasRevision[];
	} | null>(null);
	const [adoptedNodeIds, setAdoptedNodeIds] = useState<string[]>([]);
	const [canvasSession, setCanvasSession] = useState(createCanvasSessionState);
	const [kernelGraph, setKernelGraph] = useState<KernelSessionGraph | null>(
		null,
	);
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("正在恢复云端工程…");
	const [retouchDialog, setRetouchDialog] =
		useState<RetouchDialogRequest | null>(null);
	const [retouchQuote, setRetouchQuote] = useState<{
		input: CanvasGenerationRequest;
		kind: RetouchGenerationKind;
		quote: CoreCanvasGenerationQuote;
	} | null>(null);
	const [runtimePanelRefreshToken, setRuntimePanelRefreshToken] = useState(0);
	const [assetPickerOpen, setAssetPickerOpen] = useState(false);
	const [nodeGenerationPanelNodeId, setNodeGenerationPanelNodeId] = useState<
		string | null
	>(null);
	const [nodeGenerationCatalog, setNodeGenerationCatalog] =
		useState<CanvasGenerationCatalog | null>(null);
	const [nodeGenerationJobs, setNodeGenerationJobs] = useState<
		CoreCanvasGenerationJob[]
	>([]);
	const selectedNodeIds = canvasSession.selectedNodeIds;
	const setSelectedNodeIds = useCallback((ids: string[]) => {
		setCanvasSession((current) => withSelectedCanvasNodes(current, ids));
	}, []);
	const selectedRef = useRef<AdvancedCanvasProject | null>(null);
	const dirtyRef = useRef(false);
	const kernelGraphRef = useRef<KernelSessionGraph | null>(null);
	const draftSaveRef = useRef<Promise<AdvancedCanvasProject> | null>(null);
	const retouchIntentKeys = useRef(new Map<string, string>());
	const inFlightAbortRef = useRef<AbortController | null>(
		new AbortController(),
	);
	const textStreamSubscriptionsRef = useRef(new Set<string>());
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
	const requestNodeGeneration = useCallback<CanvasGenerationBackendRequest>(
		(action, input, options) => callCanvas(action, input, options),
		[callCanvas],
	);
	const loadAssetPage = useCallback(
		(input: {
			cursor?: string;
			kind?: "audio" | "image" | "video";
			query?: string;
		}) =>
			callCanvas<CanvasCursorPage<CanvasAssetListItem>>("listAssets", input),
		[callCanvas],
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
		setProjectLoadState("loading");
		try {
			const nextProjects = await projectPersistence.listProjects();
			setProjects(nextProjects);
			setMessage(
				nextProjects.length ? "工程已从云端恢复" : "创建第一个高阶画布工程",
			);
			setProjectLoadState("ready");
			return nextProjects;
		} catch (error) {
			setProjectLoadState("error");
			throw error;
		}
	}, [projectPersistence]);

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
			setNodeGenerationPanelNodeId(null);
			setNodeGenerationCatalog(null);
			setNodeGenerationJobs([]);
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
		let active = true;
		callCanvas<{ workspaceDisplayName?: unknown }>("getSessionContext")
			.then((session) => {
				if (!active) return;
				setWorkspaceDisplayName(
					merchantSafeWorkspaceDisplayName(
						session.workspaceDisplayName,
						context.workspaceId,
					),
				);
			})
			.catch(() => {
				if (active) setWorkspaceDisplayName(WORKSPACE_DISPLAY_FALLBACK);
			});
		return () => {
			active = false;
		};
	}, [callCanvas, context.workspaceId]);

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

	function openCreateProjectDialog() {
		setProjectNameDialog({ initialName: "新高阶画布", mode: "create" });
	}

	function openRenameProjectDialog() {
		if (!selected) return;
		setProjectNameDialog({
			initialName: selected.name,
			mode: "rename",
			projectId: selected.id,
		});
	}

	async function submitProjectName(name: string) {
		const dialog = projectNameDialog;
		if (!dialog) return;
		const succeeded = await run(
			async () => {
				await runAfterDirtyDraftFlush({
					action: async () => {
						if (dialog.mode === "create") {
							const project = await projectPersistence.createProject(
								name,
								emptyKernelGraph(),
							);
							await refresh();
							await loadProjectIntoShell(project.id);
							return;
						}
						const current = selectedRef.current;
						if (!current || current.id !== dialog.projectId) return;
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
			},
			dialog.mode === "create" ? "工程已创建" : "工程已重命名",
		);
		if (succeeded) setProjectNameDialog(null);
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

	function saveResourceDraft(draft: ResourceDraft) {
		const current = kernelGraphRef.current;
		if (!current || !selectedRef.current) return;
		const serialized = serializeResourceDraft(draft);
		const next = structuredClone(current);
		const configNode = next.nodes.find(
			(node) => node.type === "config" && node.data.resourceDraft !== undefined,
		);
		if (configNode) {
			configNode.data = {
				...configNode.data,
				prompt: serialized.prompt,
				resourceDraft: serialized,
			};
		} else {
			const position = kernelInsertPosition(next.nodes.length);
			next.nodes.push({
				data: { prompt: serialized.prompt, resourceDraft: serialized },
				height: 120,
				id: `config-${crypto.randomUUID()}`,
				type: "config",
				width: 280,
				...position,
			});
		}
		applyKernelGraph(next);
	}

	const nodeGenerationContext = useMemo(() => {
		if (!kernelGraph || !nodeGenerationPanelNodeId) return null;
		const node = kernelGraph.nodes.find(
			(candidate) => candidate.id === nodeGenerationPanelNodeId,
		);
		const kind = node ? canvasGenerationContextNodeKind(node.type) : null;
		return node && kind ? { kind, node } : null;
	}, [kernelGraph, nodeGenerationPanelNodeId]);
	const nodeGenerationState = useMemo(
		() =>
			nodeGenerationContext
				? restoreCanvasNodeGenerationState(
						nodeGenerationContext.node.data[CANVAS_NODE_GENERATION_STATE_KEY],
						defaultCanvasNodeGenerationOperation(nodeGenerationContext.kind),
					)
				: null,
		[nodeGenerationContext],
	);
	const nodeGenerationResourceCandidates = useMemo(
		() =>
			nodeGenerationContext
				? nodeMentionCandidates({
						edges: kernelGraph?.edges ?? [],
						nodes: kernelGraph?.nodes ?? [],
						selectedNodeIds: [nodeGenerationContext.node.id],
					})
				: [],
		[kernelGraph, nodeGenerationContext],
	);
	const canOpenNodeGeneration = useMemo(() => {
		const node = kernelGraph?.nodes.find(
			(candidate) => candidate.id === selectedNodeIds.at(0),
		);
		return Boolean(node && canvasGenerationContextNodeKind(node.type));
	}, [kernelGraph, selectedNodeIds]);

	async function updateNodeGenerationState(
		nodeId: string,
		update: (state: CanvasNodeGenerationState) => CanvasNodeGenerationState,
		updateGraph?: (graph: KernelSessionGraph) => void,
	) {
		const current = kernelGraphRef.current;
		const source = current?.nodes.find((node) => node.id === nodeId);
		const kind = source ? canvasGenerationContextNodeKind(source.type) : null;
		if (!current || !source || !kind)
			throw new Error("NODE_GENERATION_CONTEXT_REQUIRED");
		const currentState = restoreCanvasNodeGenerationState(
			source.data[CANVAS_NODE_GENERATION_STATE_KEY],
			defaultCanvasNodeGenerationOperation(kind),
		);
		const nextState = update(currentState);
		if (nextState === currentState && !updateGraph) return currentState;
		const next = structuredClone(current);
		const nextSource = next.nodes.find((node) => node.id === nodeId);
		if (!nextSource) throw new Error("NODE_GENERATION_CONTEXT_REQUIRED");
		nextSource.data = {
			...nextSource.data,
			[CANVAS_NODE_GENERATION_STATE_KEY]:
				serializeCanvasNodeGenerationState(nextState),
		};
		updateGraph?.(next);
		await applyAndPersistKernelGraph({
			applyGraph: applyKernelGraph,
			graph: next,
			persistDraft: persistSelectedDraft,
		});
		return nextState;
	}

	function commitNodeGenerationResourceDraft(draft: ResourceDraft) {
		const contextNodeId = nodeGenerationContext?.node.id;
		const current = kernelGraphRef.current;
		const source = current?.nodes.find((node) => node.id === contextNodeId);
		const kind = source ? canvasGenerationContextNodeKind(source.type) : null;
		if (!current || !source || !kind) return;
		const next = structuredClone(current);
		const nextSource = next.nodes.find((node) => node.id === contextNodeId);
		if (!nextSource) return;
		const state = restoreCanvasNodeGenerationState(
			nextSource.data[CANVAS_NODE_GENERATION_STATE_KEY],
			defaultCanvasNodeGenerationOperation(kind),
		);
		nextSource.data = {
			...nextSource.data,
			[CANVAS_NODE_GENERATION_STATE_KEY]: serializeCanvasNodeGenerationState({
				...state,
				resourceDraft: draft,
			}),
		};
		applyKernelGraph(next);
	}

	async function saveNodeGenerationBatchSnapshot(
		snapshot: NonNullable<CanvasNodeGenerationState["batchSnapshot"]>,
	) {
		const contextNodeId = nodeGenerationContext?.node.id;
		if (!contextNodeId) throw new Error("NODE_GENERATION_CONTEXT_REQUIRED");
		await updateNodeGenerationState(contextNodeId, (state) => ({
			...state,
			batchSnapshot: snapshot,
		}));
	}

	async function createNodeGenerationCheckpoint(
		operation: CanvasGenerationOperation,
	) {
		await flushDirtyDraft();
		const project = selectedRef.current;
		if (!project) throw new Error("NODE_GENERATION_PROJECT_REQUIRED");
		const checkpoint = (await projectPersistence.createCheckpoint({
			expectedDraftVersion: project.draftVersion,
			label: `${canvasGenerationOperationLabel(operation)}生成`,
			projectId: project.id,
		})) as AdvancedCanvasRevision;
		if (!checkpoint?.id?.trim())
			throw new Error("NODE_GENERATION_CHECKPOINT_REQUIRED");
		setRevisions(await projectPersistence.listRevisions(project.id));
		return { projectId: project.id, revisionId: checkpoint.id };
	}

	async function hydrateNodeGenerationJobs(
		contextNodeId: string,
		projectId: string,
	) {
		const source = kernelGraphRef.current?.nodes.find(
			(node) => node.id === contextNodeId,
		);
		const kind = source ? canvasGenerationContextNodeKind(source.type) : null;
		if (!source || !kind) return;
		const snapshot = restoreCanvasNodeGenerationState(
			source.data[CANVAS_NODE_GENERATION_STATE_KEY],
			defaultCanvasNodeGenerationOperation(kind),
		).batchSnapshot;
		const savedJobs = snapshot?.items.flatMap((item) =>
			item.job ? [item.job] : [],
		);
		if (!snapshot || !savedJobs?.length) {
			setNodeGenerationJobs([]);
			return;
		}
		const jobs = await Promise.all(
			savedJobs.map(async (job) => {
				try {
					return await callCanvas<CoreCanvasGenerationJob>("getGenerationJob", {
						jobId: job.jobId,
						projectId,
					});
				} catch {
					return null;
				}
			}),
		);
		if (selectedRef.current?.id !== projectId) return;
		const authoritative = jobs.filter(
			(job): job is CoreCanvasGenerationJob => job !== null,
		);
		setNodeGenerationJobs(authoritative);
		await updateNodeGenerationState(contextNodeId, (state) => {
			if (!state.batchSnapshot) return state;
			const reconciled = reconcileCanvasGenerationBatchJobs(
				state.batchSnapshot,
				authoritative,
			);
			return JSON.stringify(reconciled) === JSON.stringify(state.batchSnapshot)
				? state
				: { ...state, batchSnapshot: reconciled };
		});
	}

	async function openNodeGeneration() {
		const current = kernelGraphRef.current;
		const selectedNodeId = selectedNodeIds.at(0);
		const node = current?.nodes.find(
			(candidate) => candidate.id === selectedNodeId,
		);
		const project = selectedRef.current;
		if (!node || !project || !canvasGenerationContextNodeKind(node.type)) {
			setMessage("请先选择图片、文本、视频、音频或生成配置节点。");
			return;
		}
		setNodeGenerationPanelNodeId(node.id);
		setNodeGenerationCatalog(null);
		setNodeGenerationJobs([]);
		void hydrateNodeGenerationJobs(node.id, project.id).catch(
			showError(setMessage),
		);
		try {
			setNodeGenerationCatalog(
				await callCanvas<CanvasGenerationCatalog>("getCatalog"),
			);
		} catch (error) {
			showError(setMessage)(error);
		}
	}

	useEffect(() => {
		if (
			nodeGenerationPanelNodeId &&
			!selectedNodeIds.includes(nodeGenerationPanelNodeId)
		) {
			setNodeGenerationPanelNodeId(null);
		}
	}, [nodeGenerationPanelNodeId, selectedNodeIds]);

	function currentTextStreamProgress(contextNodeId: string, jobId: string) {
		const source = kernelGraphRef.current?.nodes.find(
			(node) => node.id === contextNodeId,
		);
		const kind = source ? canvasGenerationContextNodeKind(source.type) : null;
		if (!source || !kind) return null;
		return (
			restoreCanvasNodeGenerationState(
				source.data[CANVAS_NODE_GENERATION_STATE_KEY],
				defaultCanvasNodeGenerationOperation(kind),
			).textStreams.find((stream) => stream.jobId === jobId) ?? null
		);
	}

	async function saveTextStreamProgress(
		contextNodeId: string,
		progress: CanvasTextStreamProgress,
	) {
		await updateNodeGenerationState(
			contextNodeId,
			(state) => ({
				...state,
				textStreams: upsertCanvasTextStreamProgress(state, progress)
					.textStreams,
			}),
			(graph) => {
				const textNode = graph.nodes.find(
					(node) => node.id === progress.textNodeId,
				);
				if (!textNode) return;
				textNode.data = {
					...textNode.data,
					status:
						progress.state === "streaming" ? "running" : textNode.data.status,
					streamPreview: progress.preview,
					textStream: {
						...(progress.cursor ? { cursor: progress.cursor } : {}),
						sequence: progress.sequence,
						state: progress.state,
					},
				};
			},
		);
	}

	function applyTextStreamProgress(
		contextNodeId: string,
		progress: CanvasTextStreamProgress,
	) {
		const current = kernelGraphRef.current;
		const source = current?.nodes.find((node) => node.id === contextNodeId);
		const kind = source ? canvasGenerationContextNodeKind(source.type) : null;
		if (!current || !source || !kind) return;
		const next = structuredClone(current);
		const nextSource = next.nodes.find((node) => node.id === contextNodeId);
		if (!nextSource) return;
		const state = restoreCanvasNodeGenerationState(
			nextSource.data[CANVAS_NODE_GENERATION_STATE_KEY],
			defaultCanvasNodeGenerationOperation(kind),
		);
		nextSource.data = {
			...nextSource.data,
			[CANVAS_NODE_GENERATION_STATE_KEY]: serializeCanvasNodeGenerationState({
				...state,
				textStreams: upsertCanvasTextStreamProgress(state, progress)
					.textStreams,
			}),
		};
		const textNode = next.nodes.find((node) => node.id === progress.textNodeId);
		if (textNode) {
			textNode.data = {
				...textNode.data,
				status:
					progress.state === "streaming" ? "running" : textNode.data.status,
				streamPreview: progress.preview,
				textStream: {
					...(progress.cursor ? { cursor: progress.cursor } : {}),
					sequence: progress.sequence,
					state: progress.state,
				},
			};
		}
		// Deltas are a recoverable visual preview only. Existing 1200 ms autosave
		// coalesces this graph update; it is intentionally not an OCC write per token.
		applyKernelGraph(next);
	}

	async function finalizeTextGeneration(
		contextNodeId: string,
		job: CoreCanvasGenerationJob,
		progress: CanvasTextStreamProgress,
		inputNodeIds: string[],
	) {
		const durable = await callCanvas<CoreCanvasGenerationJob>(
			"getGenerationJob",
			{ jobId: job.jobId, projectId: job.projectId },
		);
		setNodeGenerationJobs((current) =>
			mergeCanvasGenerationJobs(current, [durable]),
		);
		const deliverable = durable.deliverable;
		if (!deliverable || deliverable.kind !== "text") {
			await saveTextStreamProgress(contextNodeId, {
				...progress,
				state: "disconnected",
			});
			return;
		}
		await updateNodeGenerationState(
			contextNodeId,
			(state) => ({
				...state,
				textStreams: removeCanvasTextStreamProgress(state, job.jobId)
					.textStreams,
			}),
			(graph) => {
				const textNode = graph.nodes.find(
					(node) => node.id === progress.textNodeId,
				);
				if (!textNode) return;
				textNode.data = {
					...textNode.data,
					jobId: durable.jobId,
					status: durable.status,
					text: deliverable.text,
				};
				delete textNode.data.streamPreview;
				delete textNode.data.textStream;
				const currentEdges = generatedResultEdges({
					existingEdges: graph.edges,
					inputNodeIds,
					resultNodeId: textNode.id,
				});
				graph.edges.push(...currentEdges);
			},
		);
	}

	async function consumeTextGenerationStream(
		contextNodeId: string,
		job: CoreCanvasGenerationJob,
		inputNodeIds: string[],
	) {
		if (textStreamSubscriptionsRef.current.has(job.jobId)) return;
		const initial = currentTextStreamProgress(contextNodeId, job.jobId);
		if (!initial) return;
		textStreamSubscriptionsRef.current.add(job.jobId);
		let terminal = false;
		try {
			const result = await streamCanvasTextGeneration(
				{
					jobId: job.jobId,
					...(initial.cursor ? { lastEventId: initial.cursor } : {}),
					projectId: job.projectId,
				},
				{
					// Deliberately no AbortSignal: ending a browser subscription must not
					// cancel the Core producer behind this durable job.
					onEvent: async (event) => {
						await handleCanvasTextStreamEvent(
							contextNodeId,
							job,
							inputNodeIds,
							event,
							() => {
								terminal = true;
							},
						);
					},
				},
			);
			if (!terminal) {
				const current = currentTextStreamProgress(contextNodeId, job.jobId);
				if (current) {
					await saveTextStreamProgress(contextNodeId, {
						...current,
						...(result.lastEventId ? { cursor: result.lastEventId } : {}),
						state: "disconnected",
					});
				}
			}
		} catch {
			const current = currentTextStreamProgress(contextNodeId, job.jobId);
			if (terminal && current?.state === "terminal") {
				await saveTextStreamProgress(contextNodeId, {
					...current,
					state: "disconnected",
				});
				setMessage("文本结果尚未确认，可从上次进度恢复。");
			} else if (!terminal) {
				if (current) {
					await saveTextStreamProgress(contextNodeId, {
						...current,
						state: "disconnected",
					});
				}
				setMessage("文本预览已断开，可从上次进度恢复。");
			}
		} finally {
			textStreamSubscriptionsRef.current.delete(job.jobId);
		}
	}

	async function handleCanvasTextStreamEvent(
		contextNodeId: string,
		job: CoreCanvasGenerationJob,
		inputNodeIds: string[],
		event: CanvasTextStreamEvent,
		markTerminal: () => void,
	) {
		if (event.jobId !== job.jobId) return;
		const current = currentTextStreamProgress(contextNodeId, job.jobId);
		if (!current || event.sequence <= current.sequence) return;
		if (event.type === "delta") {
			applyTextStreamProgress(contextNodeId, {
				...current,
				...(event.cursor ? { cursor: event.cursor } : {}),
				preview: `${current.preview}${event.delta}`,
				sequence: event.sequence,
				state: "streaming",
			});
			return;
		}
		if (event.type === "recoverable") {
			await saveTextStreamProgress(contextNodeId, {
				...current,
				...(event.cursor ? { cursor: event.cursor } : {}),
				sequence: event.sequence,
				state: "disconnected",
			});
			return;
		}
		markTerminal();
		const progress = {
			...current,
			...(event.cursor ? { cursor: event.cursor } : {}),
			sequence: event.sequence,
			state: "terminal" as const,
		};
		if (event.status === "completed") {
			// Persist the terminal cursor before the separate durable-job read. If that
			// read races delivery, reopening the panel still has a recoverable record.
			await saveTextStreamProgress(contextNodeId, progress);
			await finalizeTextGeneration(contextNodeId, job, progress, inputNodeIds);
			return;
		}
		await saveTextStreamProgress(contextNodeId, progress);
	}

	async function startTextGenerationItems(
		items: readonly CanvasNodeGenerationSubmittedItem[],
	) {
		const contextNodeId = nodeGenerationContext?.node.id;
		if (!contextNodeId) return;
		for (const item of items) {
			const existing = currentTextStreamProgress(contextNodeId, item.job.jobId);
			let progress = existing;
			if (!progress) {
				const textNodeId = `generated-${crypto.randomUUID()}`;
				progress = {
					jobId: item.job.jobId,
					preview: "",
					sequence: 0,
					state: "streaming",
					textNodeId,
				};
				const initialProgress = progress;
				await updateNodeGenerationState(
					contextNodeId,
					(state) => ({
						...state,
						textStreams: upsertCanvasTextStreamProgress(state, initialProgress)
							.textStreams,
					}),
					(graph) => {
						const position = kernelInsertPosition(graph.nodes.length);
						graph.nodes.push({
							data: {
								jobId: item.job.jobId,
								status: "running",
								streamPreview: "",
								text: "",
								textStream: { sequence: 0, state: "streaming" },
							},
							height: 160,
							id: textNodeId,
							type: "text",
							width: 260,
							...position,
						});
						graph.edges.push(
							...generatedResultEdges({
								existingEdges: graph.edges,
								inputNodeIds: item.input.inputNodeBindings.map(
									(binding) => binding.nodeId,
								),
								resultNodeId: textNodeId,
							}),
						);
					},
				);
			}
			void consumeTextGenerationStream(
				contextNodeId,
				item.job,
				item.input.inputNodeBindings.map((binding) => binding.nodeId),
			);
		}
	}

	function resumeTextGeneration(job: CoreCanvasGenerationJob) {
		const contextNodeId = nodeGenerationContext?.node.id;
		if (!contextNodeId) return;
		const inputNodeIds =
			nodeGenerationState?.batchSnapshot?.items
				.find((item) => item.job?.jobId === job.jobId)
				?.input.inputNodeBindings.map((binding) => binding.nodeId) ?? [];
		void consumeTextGenerationStream(contextNodeId, job, inputNodeIds);
	}

	function applyKernelViewport(viewport: KernelSessionGraph["viewport"]) {
		const current = kernelGraphRef.current;
		if (!current) return;
		const next = { ...current, viewport };
		kernelGraphRef.current = next;
		setKernelGraph(next);
		setCanvasSession((session) => withCanvasViewport(session, viewport));
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

	function requestProjectDeletion(projectIds: string[]) {
		const targets = selectedProjectsForDeletion(projects, projectIds);
		if (targets.length)
			setDeletingProjectIds(targets.map((project) => project.id));
	}

	async function deleteSelectedProjects() {
		const projectIds = deletingProjectIds;
		if (!projectIds?.length) return;
		const succeeded = await run(
			async () => {
				await runAfterDirtyDraftFlush({
					action: async () => {
						const deletingCurrent = Boolean(
							selectedRef.current &&
								projectIds.includes(selectedRef.current.id),
						);
						for (const projectId of projectIds) {
							await projectPersistence.deleteProject(projectId);
						}
						if (deletingCurrent) {
							selectedRef.current = null;
							setSelected(null);
							kernelGraphRef.current = null;
							setKernelGraph(null);
							setSelectedNodeIds([]);
							setRevisions([]);
							dirtyRef.current = false;
							setDirty(false);
						}
						setSelectedProjectIds((current) =>
							current.filter((projectId) => !projectIds.includes(projectId)),
						);
						await refresh();
					},
					flushDraft: flushDirtyDraft,
					isDirty: () => dirtyRef.current,
				});
			},
			projectIds.length === 1
				? "工程已软删除"
				: `${projectIds.length} 个工程已软删除`,
		);
		if (succeeded) setDeletingProjectIds(null);
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

	function requestRestore(revisionId: string) {
		setRestoreRevisionId(revisionId);
	}

	async function restoreRevisionAsDraft() {
		const revisionId = restoreRevisionId;
		if (!revisionId) return;
		const succeeded = await run(async () => {
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
		if (succeeded) setRestoreRevisionId(null);
	}

	async function openExportDialog(project: AdvancedCanvasProject) {
		setBusy(true);
		try {
			const projectRevisions =
				project.id === selectedRef.current?.id
					? revisions
					: await projectPersistence.listRevisions(project.id);
			if (projectRevisions.length === 0) {
				setMessage("请先创建冻结检查点，再导出工程。");
				return;
			}
			setExportDialog({ project, revisions: projectRevisions });
		} catch (error) {
			showError(setMessage)(error);
		} finally {
			setBusy(false);
		}
	}

	async function exportFrozenRevision(
		input: Parameters<typeof downloadCanvasExport>[0],
	) {
		const dialog = exportDialog;
		if (!dialog) return;
		setBusy(true);
		setMessage("正在由服务端准备冻结检查点 ZIP…");
		try {
			const exported = await downloadCanvasExport({
				idempotencyKey: input.idempotencyKey,
				...(input.includeAvailableOnly ? { includeAvailableOnly: true } : {}),
				projectId: dialog.project.id,
				revisionId: input.revisionId,
			});
			setExportDialog(null);
			setMessage(
				exported.manifestSha256
					? `已安全下载 ${exported.fileName}。Manifest SHA-256：${exported.manifestSha256}`
					: `已安全下载 ${exported.fileName}。服务端未返回 manifest hash。`,
			);
		} catch (error) {
			setMessage(
				error instanceof CanvasBackendError
					? `导出失败：${error.message}`
					: "导出失败，请重试。",
			);
		} finally {
			setBusy(false);
		}
	}

	async function uploadAssetForPicker(
		file: File,
	): Promise<CanvasAssetListItem | null> {
		const validation = validateCanvasUpload(file);
		if (validation) throw new Error(validation);
		const kind = resourceKindFromContentType(file.type);
		if (!kind) return null;
		const persisted = await persistBlobAsOwnedAsset(callCanvas, {
			bytesBase64: await fileToBase64(file),
			contentType: file.type,
			derivation: "retouch",
			fileName: file.name,
		});
		return { id: persisted.id, kind, title: file.name };
	}

	function insertListedAsset(asset: CanvasAssetListItem) {
		insertOwnedAsset({
			contentType: contentTypeForResourceKind(asset.kind),
			id: asset.id,
		});
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
		const acceptedFiles = files.filter(
			(file) => validateCanvasUpload(file) === null,
		);
		if (acceptedFiles.length === 0) {
			const firstFile = files[0];
			if (!firstFile) return;
			setMessage(validateCanvasUpload(firstFile) ?? "请选择可用素材文件。");
			return;
		}
		await run(async () => {
			const next = structuredClone(kernelGraphRef.current);
			if (!next) return;
			const insertedIds: string[] = [];
			for (const [index, file] of acceptedFiles.entries()) {
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
		}, "素材已持久化并插入画布");
	}

	async function openRetouchDialog(
		kind: RetouchDialogRequest["kind"],
		nodeId: string,
	) {
		await run(async () => {
			const sourceNode = kernelGraphRef.current?.nodes.find(
				(node) => node.id === nodeId,
			);
			if (!sourceNode) throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
			const dataUrl = await loadSourceImageDataUrl({ sourceNode });
			setRetouchDialog({ dataUrl, kind, nodeId });
		}, retouchDialogOpenedMessage(kind));
	}

	async function confirmCrop(nodeId: string, crop: RetouchCropRect) {
		setRetouchDialog(null);
		await run(async () => {
			const current = kernelGraphRef.current;
			const sourceNode = current?.nodes.find((node) => node.id === nodeId);
			if (!current || !sourceNode)
				throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
			const derived = await cropOwnedImageAsset(callCanvas, {
				crop,
				sourceNode,
			});
			const next = structuredClone(current);
			next.nodes.push(derived.node);
			next.edges.push(derived.edge);
			setSelectedNodeIds([derived.node.id]);
			await applyAndPersistKernelGraph({
				applyGraph: applyKernelGraph,
				graph: next,
				persistDraft: persistSelectedDraft,
			});
		}, "裁切结果已生成并保存");
	}

	async function confirmUpscale(nodeId: string, params: RetouchUpscaleParams) {
		setRetouchDialog(null);
		await run(async () => {
			const current = kernelGraphRef.current;
			const sourceNode = current?.nodes.find((node) => node.id === nodeId);
			if (!current || !sourceNode)
				throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
			const derived = await upscaleOwnedImageAsset(callCanvas, {
				params,
				sourceNode,
			});
			const next = structuredClone(current);
			next.nodes.push(derived.node);
			next.edges.push(derived.edge);
			setSelectedNodeIds([derived.node.id]);
			await applyAndPersistKernelGraph({
				applyGraph: applyKernelGraph,
				graph: next,
				persistDraft: persistSelectedDraft,
			});
		}, "放大结果已生成并保存");
	}

	async function confirmSplit(nodeId: string, params: RetouchSplitParams) {
		setRetouchDialog(null);
		await run(async () => {
			const current = kernelGraphRef.current;
			const sourceNode = current?.nodes.find((node) => node.id === nodeId);
			if (!current || !sourceNode)
				throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
			const derived = await splitOwnedImageAsset(callCanvas, {
				params,
				sourceNode,
			});
			const next = structuredClone(current);
			for (const piece of derived.pieces) {
				next.nodes.push(piece.node);
				next.edges.push(piece.edge);
			}
			setSelectedNodeIds(derived.pieces.map((piece) => piece.node.id));
			await applyAndPersistKernelGraph({
				applyGraph: applyKernelGraph,
				graph: next,
				persistDraft: persistSelectedDraft,
			});
		}, "切分结果已生成并保存");
	}

	function retouchIntentKey(
		stage: "quote" | "submit",
		input: CanvasGenerationRequest,
	) {
		const fingerprint = `${stage}:${JSON.stringify(input)}`;
		const existing = retouchIntentKeys.current.get(fingerprint);
		if (existing) return existing;
		const created = crypto.randomUUID();
		retouchIntentKeys.current.set(fingerprint, created);
		return created;
	}

	async function createRetouchCheckpoint(kind: RetouchGenerationKind) {
		await flushDirtyDraft();
		const project = selectedRef.current;
		if (!project) throw new Error("RETOUCH_PROJECT_REQUIRED");
		const checkpoint = (await projectPersistence.createCheckpoint({
			expectedDraftVersion: project.draftVersion,
			label: `${retouchGenerationLabel(kind)}生成`,
			projectId: project.id,
		})) as AdvancedCanvasRevision;
		if (!checkpoint?.id?.trim()) throw new Error("RETOUCH_CHECKPOINT_REQUIRED");
		setRevisions(await projectPersistence.listRevisions(project.id));
		return { projectId: project.id, revisionId: checkpoint.id };
	}

	async function requestRetouchQuote(input: {
		angleParams?: RetouchAngleDialogParams;
		kind: RetouchGenerationKind;
		maskNode?: KernelSessionGraph["nodes"][number];
		prompt?: string;
		sourceNode: KernelSessionGraph["nodes"][number];
	}) {
		const catalog = await callCanvas<RetouchCatalog>("getCatalog");
		const capability = activeRetouchCapability(catalog.operations, input.kind);
		const checkpoint = await createRetouchCheckpoint(input.kind);
		const generationInput = buildRetouchGenerationInput({
			angleParams: input.angleParams,
			capability,
			kind: input.kind,
			maskNode: input.maskNode,
			projectId: checkpoint.projectId,
			prompt: input.prompt,
			revisionId: checkpoint.revisionId,
			sourceNode: input.sourceNode,
		});
		const quote = await callCanvas<CoreCanvasGenerationQuote>(
			"quoteGeneration",
			generationInput,
			{ idempotencyKey: retouchIntentKey("quote", generationInput) },
		);
		setRetouchQuote({
			input: generationInput,
			kind: input.kind,
			quote,
		});
	}

	async function confirmMask(nodeId: string, payload: RetouchMaskEditPayload) {
		setRetouchDialog(null);
		await run(async () => {
			const current = kernelGraphRef.current;
			const sourceNode = current?.nodes.find((node) => node.id === nodeId);
			if (!current || !sourceNode)
				throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
			const mask = await persistMaskOwnedImageAsset(callCanvas, {
				maskDataUrl: payload.maskDataUrl,
				sourceNode,
			});
			const next = structuredClone(current);
			next.nodes.push(mask.node);
			next.edges.push(mask.edge);
			setSelectedNodeIds([mask.node.id]);
			await applyAndPersistKernelGraph({
				applyGraph: applyKernelGraph,
				graph: next,
				persistDraft: persistSelectedDraft,
			});
			await requestRetouchQuote({
				kind: "mask",
				maskNode: mask.node,
				prompt: payload.prompt,
				sourceNode,
			});
		}, "局部编辑报价已固定，可确认提交");
	}

	async function confirmAngle(
		nodeId: string,
		params: RetouchAngleDialogParams,
	) {
		setRetouchDialog(null);
		await run(async () => {
			const sourceNode = kernelGraphRef.current?.nodes.find(
				(node) => node.id === nodeId,
			);
			if (!sourceNode) throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
			await requestRetouchQuote({
				angleParams: params,
				kind: "angle",
				sourceNode,
			});
		}, "AI 多角度报价已固定，可确认提交");
	}

	async function requestReversePrompt(nodeId: string) {
		await run(async () => {
			const sourceNode = kernelGraphRef.current?.nodes.find(
				(node) => node.id === nodeId,
			);
			if (!sourceNode) throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
			await loadSourceImageDataUrl({ sourceNode });
			await requestRetouchQuote({ kind: "reversePrompt", sourceNode });
		}, "反推提示词报价已固定，可确认提交");
	}

	async function createReversePromptConfig(
		job: CoreCanvasGenerationJob,
		input: CanvasGenerationRequest,
	) {
		const sourceNodeId = input.inputNodeBindings.find(
			(binding) => binding.role === "reference_image",
		)?.nodeId;
		const current = kernelGraphRef.current;
		if (
			!current ||
			!sourceNodeId ||
			!current.nodes.some((node) => node.id === sourceNodeId)
		) {
			throw new Error("RETOUCH_SOURCE_LINEAGE_REQUIRED");
		}
		if (current.nodes.some((node) => node.data.jobId === job.jobId)) return;
		const configNodeId = `config-${crypto.randomUUID()}`;
		const position = kernelInsertPosition(current.nodes.length);
		const next = structuredClone(current);
		next.nodes.push({
			data: reversePromptConfigData(
				job.jobId,
				job.deliverable?.kind === "text" ? job.deliverable.text : undefined,
			),
			height: 120,
			id: configNodeId,
			type: "config",
			width: 280,
			...position,
		});
		next.edges.push(
			...generatedResultEdges({
				existingEdges: next.edges,
				inputNodeIds: [sourceNodeId],
				resultNodeId: configNodeId,
			}),
		);
		setSelectedNodeIds([configNodeId]);
		await applyAndPersistKernelGraph({
			applyGraph: applyKernelGraph,
			graph: next,
			persistDraft: persistSelectedDraft,
		});
	}

	async function submitRetouchGeneration() {
		const pending = retouchQuote;
		if (!pending) return;
		await run(
			async () => {
				const job = await callCanvas<CoreCanvasGenerationJob>(
					"submitGeneration",
					canvasGenerationSubmitPayload(pending.input, pending.quote),
					{ idempotencyKey: retouchIntentKey("submit", pending.input) },
				);
				if (!job.jobId?.trim()) throw new Error("RETOUCH_JOB_REQUIRED");
				if (pending.kind === "reversePrompt") {
					await createReversePromptConfig(job, pending.input);
				}
				setRetouchQuote(null);
				setRuntimePanelRefreshToken((current) => current + 1);
			},
			`${retouchGenerationLabel(pending.kind)}任务已提交；可在生成记录中查看、取消或插入画布`,
		);
	}

	async function insertGenerated(
		job: CoreCanvasGenerationJob,
		inputNodeIds: string[],
	) {
		const reversePromptConfig = kernelGraphRef.current?.nodes.find((node) =>
			isReversePromptConfigNode(node, job.jobId),
		);
		if (reversePromptConfig && job.deliverable?.kind === "text") {
			const prompt = job.deliverable.text;
			if (!selected || job.projectId !== selected.id) return;
			await run(async () => {
				const current = kernelGraphRef.current;
				if (!current) return;
				const next = structuredClone(current);
				const configNode = next.nodes.find(
					(node) => node.id === reversePromptConfig.id,
				);
				if (!configNode) throw new Error("RETOUCH_CONFIG_NODE_REQUIRED");
				configNode.data = {
					...configNode.data,
					...reversePromptConfigData(job.jobId, prompt),
				};
				setSelectedNodeIds([configNode.id]);
				await applyAndPersistKernelGraph({
					applyGraph: applyKernelGraph,
					graph: next,
					persistDraft: persistSelectedDraft,
				});
			}, "反推提示词已写入配置节点并保存");
			return;
		}
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
			return true;
		} catch (error) {
			showError(setMessage)(error);
			return false;
		} finally {
			setBusy(false);
		}
	}

	const deletingProjects = selectedProjectsForDeletion(
		projects,
		deletingProjectIds ?? [],
	);
	const restoringRevision = revisions.find(
		(revision) => revision.id === restoreRevisionId,
	);

	return (
		<main className="studio-shell">
			<header className="studio-topbar">
				<div>
					<span className="studio-mark">Pro Studio</span>
					<span className="workspace-name">{workspaceDisplayName}</span>
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
						<div className="rail-actions">
							{selectedProjectIds.length > 0 ? (
								<button
									disabled={busy}
									onClick={() => requestProjectDeletion(selectedProjectIds)}
									type="button"
								>
									删除已选（{selectedProjectIds.length}）
								</button>
							) : null}
							<button
								disabled={busy}
								onClick={openCreateProjectDialog}
								type="button"
							>
								新建
							</button>
						</div>
					</div>
					<div
						aria-busy={projectLoadState === "loading"}
						className="project-list"
					>
						{projectLoadState === "loading" ? (
							<div className="project-list-skeleton">
								<p>正在加载工程</p>
								<span aria-hidden="true" />
								<span aria-hidden="true" />
								<span aria-hidden="true" />
							</div>
						) : null}
						{projectLoadState === "error" ? (
							<div className="project-list-state">
								<p aria-live="polite">工程暂时无法加载。</p>
								<button
									disabled={busy}
									onClick={() => void refresh().catch(showError(setMessage))}
									type="button"
								>
									重试
								</button>
							</div>
						) : null}
						{projectLoadState === "ready" && projects.length === 0 ? (
							<div className="project-list-state">
								<p>还没有工程，先创建一张可恢复的画布。</p>
								<button onClick={openCreateProjectDialog} type="button">
									新建工程
								</button>
							</div>
						) : null}
						{projectLoadState === "ready" &&
							projects.map((project) => {
								const metadata = projectCardMetadata(project);
								const isOpen = selected?.id === project.id;
								const isSelected = selectedProjectIds.includes(project.id);
								return (
									<article
										className={isOpen ? "project-card active" : "project-card"}
										key={project.id}
									>
										<label className="project-card-selection">
											<input
												aria-label={`选择工程 ${project.name}`}
												checked={isSelected}
												disabled={busy}
												onChange={(event) => {
													setSelectedProjectIds((current) =>
														toggleProjectSelection(
															current,
															project.id,
															event.target.checked,
														),
													);
												}}
												type="checkbox"
											/>
											<span>选择</span>
										</label>
										<button
											aria-current={isOpen ? "page" : undefined}
											className="project-card-open"
											disabled={busy}
											onClick={() => void openProject(project.id)}
											type="button"
										>
											<strong>{project.name}</strong>
											<small>
												{metadata.nodeCount} 个节点 · {metadata.edgeCount}{" "}
												条连线
											</small>
											<small>更新于 {metadata.updatedAt}</small>
										</button>
										<div className="project-card-actions">
											<button
												aria-label={`导出工程 ${project.name}`}
												disabled={busy}
												onClick={() => void openExportDialog(project)}
												type="button"
											>
												导出
											</button>
											<button
												aria-label={`删除工程 ${project.name}`}
												className="danger"
												disabled={busy}
												onClick={() => requestProjectDeletion([project.id])}
												type="button"
											>
												删除
											</button>
										</div>
									</article>
								);
							})}
					</div>
					<div className="asset-library">
						<div className="rail-heading">
							<h2>素材库</h2>
							<button
								disabled={!selected}
								onClick={() => setAssetPickerOpen(true)}
								type="button"
							>
								选择或上传
							</button>
						</div>
						<p className="asset-library-help">
							按图片、视频或音频分页查询；素材归属由服务端复核。
						</p>
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
									disabled={!canOpenNodeGeneration || busy}
									onClick={() => void openNodeGeneration()}
									type="button"
								>
									节点生成
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
								<button
									disabled={busy}
									onClick={openRenameProjectDialog}
									type="button"
								>
									重命名
								</button>
								<button type="button" onClick={duplicateProject}>
									复制
								</button>
								<button
									disabled={busy}
									onClick={() => void openExportDialog(selected)}
									type="button"
								>
									导出
								</button>
								<button
									className="danger"
									disabled={busy}
									type="button"
									onClick={() => requestProjectDeletion([selected.id])}
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
										onAngleSelected={(nodeId) =>
											void openRetouchDialog("angle", nodeId)
										}
										onCropSelected={(nodeId) =>
											void openRetouchDialog("crop", nodeId)
										}
										onImportFiles={importFiles}
										onMaskEditSelected={(nodeId) =>
											void openRetouchDialog("mask", nodeId)
										}
										onOpenAssets={() => setAssetPickerOpen(true)}
										onReversePromptSelected={(nodeId) =>
											void requestReversePrompt(nodeId)
										}
										onSelectNodes={setSelectedNodeIds}
										onSplitSelected={(nodeId) =>
											void openRetouchDialog("split", nodeId)
										}
										onUpload={() => setAssetPickerOpen(true)}
										onUpscaleSelected={(nodeId) =>
											void openRetouchDialog("upscale", nodeId)
										}
										onViewportChange={applyKernelViewport}
										selectedNodeIds={selectedNodeIds}
									/>
								) : null}
								<RetouchDialogs
									request={retouchDialog}
									onClose={() => setRetouchDialog(null)}
									onConfirmAngle={(nodeId, params) =>
										void confirmAngle(nodeId, params)
									}
									onConfirmCrop={(nodeId, crop) =>
										void confirmCrop(nodeId, crop)
									}
									onConfirmMask={(nodeId, payload) =>
										void confirmMask(nodeId, payload)
									}
									onConfirmSplit={(nodeId, params) =>
										void confirmSplit(nodeId, params)
									}
									onConfirmUpscale={(nodeId, params) =>
										void confirmUpscale(nodeId, params)
									}
								/>
								<RetouchQuoteDialog
									busy={busy}
									onClose={() => setRetouchQuote(null)}
									onConfirm={() => void submitRetouchGeneration()}
									request={
										retouchQuote
											? {
													kind: retouchQuote.kind,
													label: retouchGenerationLabel(retouchQuote.kind),
													priceRevision: retouchQuote.quote.priceRevision,
												}
											: null
									}
								/>
							</section>
							{nodeGenerationContext && nodeGenerationState ? (
								<CanvasNodeGenerationWorkbench
									batchSnapshot={nodeGenerationState.batchSnapshot ?? null}
									catalog={nodeGenerationCatalog}
									context={{ kind: nodeGenerationContext.kind }}
									jobs={nodeGenerationJobs}
									key={nodeGenerationContext.node.id}
									loadAssets={loadAssetPage}
									onBatchSnapshotChange={saveNodeGenerationBatchSnapshot}
									onClose={() => setNodeGenerationPanelNodeId(null)}
									onJobUpdated={(job) =>
										setNodeGenerationJobs((current) =>
											mergeCanvasGenerationJobs(current, [job]),
										)
									}
									onJobsSubmitted={(jobs) =>
										setNodeGenerationJobs((current) =>
											mergeCanvasGenerationJobs(current, jobs),
										)
									}
									onResourceDraftChange={commitNodeGenerationResourceDraft}
									onResumeTextGeneration={resumeTextGeneration}
									onTextGenerationSubmitted={startTextGenerationItems}
									prepareQuoteCheckpoint={createNodeGenerationCheckpoint}
									request={requestNodeGeneration}
									resourceDraft={nodeGenerationState.resourceDraft}
									resourceNodeCandidates={nodeGenerationResourceCandidates}
									resourceNodes={kernelGraph?.nodes ?? []}
									textStreams={nodeGenerationState.textStreams}
								/>
							) : null}
							<div className="revision-strip">
								<strong>检查点</strong>
								{revisions.length === 0 ? (
									<span>尚无检查点</span>
								) : (
									revisions.map((revision) => (
										<button
											key={revision.id}
											type="button"
											onClick={() => requestRestore(revision.id)}
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
							<button type="button" onClick={openCreateProjectDialog}>
								新建工程
							</button>
						</div>
					)}
				</section>
				<RuntimePanel
					key={`${selected?.id ?? "no-project"}-${runtimePanelRefreshToken}`}
					graph={kernelGraph}
					mainReturnUrl={returnUrl}
					onAdoptedNodesChange={setAdoptedNodeIds}
					onInsertGenerated={insertGenerated}
					onReloadProject={openProject}
					onResourceDraftChange={saveResourceDraft}
					persistDraft={persistSelectedDraft}
					project={selected}
					requestAbortRef={inFlightAbortRef}
					revisions={revisions}
					selectedNodeIds={selectedNodeIds}
				/>
			</div>
			{projectNameDialog ? (
				<ProjectNameDialog
					busy={busy}
					initialName={projectNameDialog.initialName}
					key={`${projectNameDialog.mode}:${projectNameDialog.projectId ?? "new"}`}
					mode={projectNameDialog.mode}
					onClose={() => setProjectNameDialog(null)}
					onSubmit={(name) => void submitProjectName(name)}
				/>
			) : null}
			{deletingProjectIds ? (
				<DeleteProjectsDialog
					busy={busy}
					onClose={() => setDeletingProjectIds(null)}
					onConfirm={() => void deleteSelectedProjects()}
					projects={deletingProjects}
				/>
			) : null}
			{restoreRevisionId ? (
				<RestoreRevisionDialog
					busy={busy}
					onClose={() => setRestoreRevisionId(null)}
					onConfirm={() => void restoreRevisionAsDraft()}
					revisionLabel={
						restoringRevision?.label ??
						(restoringRevision
							? `检查点 v${restoringRevision.draftVersion}`
							: "所选检查点")
					}
				/>
			) : null}
			{exportDialog ? (
				<CanvasExportDialog
					busy={busy}
					key={exportDialog.project.id}
					onClose={() => setExportDialog(null)}
					onExport={(input) => void exportFrozenRevision(input)}
					projectId={exportDialog.project.id}
					projectName={exportDialog.project.name}
					revisions={exportDialog.revisions}
				/>
			) : null}
			<CanvasAssetPicker
				loadPage={loadAssetPage}
				onClose={() => setAssetPickerOpen(false)}
				onInsert={insertListedAsset}
				onUpload={uploadAssetForPicker}
				open={assetPickerOpen}
			/>
		</main>
	);
}

function contentTypeForResourceKind(kind: CanvasAssetListItem["kind"]): string {
	switch (kind) {
		case "audio":
			return "audio/mpeg";
		case "image":
			return "image/png";
		case "video":
			return "video/mp4";
	}
}

function canvasGenerationContextNodeKind(
	type: string,
): CanvasGenerationContextNodeKind | null {
	return type === "audio" ||
		type === "config" ||
		type === "image" ||
		type === "text" ||
		type === "video"
		? type
		: null;
}

function canvasGenerationOperationLabel(operation: CanvasGenerationOperation) {
	switch (operation) {
		case "audio.sfx":
			return "音效";
		case "audio.speech":
			return "语音";
		case "image.edit":
			return "图片编辑";
		case "image.generate":
			return "图片";
		case "text.respond":
			return "文本";
		case "video.generate":
			return "视频";
	}
}

function mergeCanvasGenerationJobs(
	current: readonly CoreCanvasGenerationJob[],
	incoming: readonly CoreCanvasGenerationJob[],
) {
	const byId = new Map(current.map((job) => [job.jobId, job]));
	for (const job of incoming) byId.set(job.jobId, job);
	return [...byId.values()];
}

function retouchDialogOpenedMessage(kind: RetouchDialogRequest["kind"]) {
	switch (kind) {
		case "angle":
			return "AI 多角度参数已打开";
		case "crop":
			return "裁剪面板已打开";
		case "mask":
			return "局部编辑面板已打开";
		case "split":
			return "切分参数已打开";
		case "upscale":
			return "放大参数已打开";
	}
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

"use client";

import type {
	AdvancedCanvasProject,
	AdvancedCanvasRevision,
} from "@meiye/core/pro-studio";
import type {
	AgentAuditEvent,
	AgentPlan,
	CanvasGenerationCatalogEntry,
	CanvasGenerationOperation,
} from "@meiye/core/pro-studio-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildAdoptionInput } from "../kernel-host/adoption-adapter";
import {
	AgentAdapter,
	type AgentCredential,
	type AgentOperationConfirmationState,
	applyAgentAndRefreshAudit,
	createAgentOperationConfirmationState,
	isAgentPlanFullyConfirmed,
	rejectAgentPlan,
	setAgentOperationConfirmed,
} from "../kernel-host/agent-adapter";
import {
	type CatalogEntry,
	honestAvailability,
} from "../kernel-host/generation-adapter";
import type { KernelSessionGraph } from "../kernel-host/graph-bridge";
import { callCanvas as callCanvasRequest } from "./backend-client";
import {
	buildCanvasGenerationInput,
	type CanvasGenerationInputAssetRole,
	type CoreCanvasGenerationJob,
	type CoreCanvasGenerationQuote,
	canvasGenerationCancelPayload,
	canvasGenerationJobPresentation,
	canvasGenerationSubmitPayload,
	freezeCanvasGenerationInputs,
	isCanvasGenerationCancellable,
	resolveGenerationJobInputNodeIds,
} from "./generation-ui-contract";
import { CANVAS_PROMPT_SEEDS } from "./prompt-seeds";

interface RuntimePanelProps {
	graph: KernelSessionGraph | null;
	mainReturnUrl: string;
	onAdoptedNodesChange(nodeIds: string[]): void;
	onInsertGenerated(job: CoreCanvasGenerationJob, inputNodeIds: string[]): void;
	onReloadProject(projectId: string): Promise<void>;
	persistDraft(): Promise<AdvancedCanvasProject | null>;
	project: AdvancedCanvasProject | null;
	requestAbortRef?: { current: AbortController | null };
	revisions: AdvancedCanvasRevision[];
	selectedNodeIds: string[];
}

type Catalog = {
	agent: { activation: "active" | "inactive"; reason?: string };
	operations: Array<
		CanvasGenerationCatalogEntry & {
			allowedInputAssetRoles: CanvasGenerationInputAssetRole[];
			unavailableReason?: string;
		}
	>;
};

type Adoption = {
	createdAt?: string;
	packageId: string;
	projectId: string;
	revisionId: string;
	selectedNodeIds: string[];
	versionId: string;
};

const operationLabels: Record<CanvasGenerationOperation, string> = {
	"audio.sfx": "音效生成",
	"audio.speech": "语音合成",
	"image.edit": "图片编辑 / 蒙版",
	"image.generate": "图片生成",
	"text.respond": "自由文本 / 图片反推",
	"video.generate": "视频生成",
};

export function RuntimePanel({
	graph,
	mainReturnUrl,
	onAdoptedNodesChange,
	onInsertGenerated,
	onReloadProject,
	persistDraft,
	project,
	requestAbortRef,
	revisions,
	selectedNodeIds,
}: RuntimePanelProps) {
	const [catalog, setCatalog] = useState<Catalog | null>(null);
	const [operation, setOperation] =
		useState<CanvasGenerationOperation>("image.generate");
	const [prompt, setPrompt] = useState("");
	const [selectedSeedId, setSelectedSeedId] = useState("");
	const [maskNodeId, setMaskNodeId] = useState("");
	const [quote, setQuote] = useState<CoreCanvasGenerationQuote | null>(null);
	const [jobs, setJobs] = useState<CoreCanvasGenerationJob[]>([]);
	const [adoptions, setAdoptions] = useState<Adoption[]>([]);
	const [adoptionTarget, setAdoptionTarget] = useState<
		"new_package" | "existing_package"
	>("new_package");
	const [targetPackageId, setTargetPackageId] = useState("");
	const [targetBaseVersionId, setTargetBaseVersionId] = useState("");
	const [targetExpectedRevision, setTargetExpectedRevision] = useState(0);
	const [agentIntent, setAgentIntent] = useState("");
	const [agentMaxCostMicros, setAgentMaxCostMicros] = useState(0);
	const [agentMaxGenerationCount, setAgentMaxGenerationCount] = useState(0);
	const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
	const [agentConfirmations, setAgentConfirmations] =
		useState<AgentOperationConfirmationState>(() =>
			createAgentOperationConfirmationState(0),
		);
	const [credential, setCredential] = useState<AgentCredential | null>(null);
	const [agentReloadRequired, setAgentReloadRequired] = useState(false);
	const [auditWarning, setAuditWarning] = useState("");
	const [audit, setAudit] = useState<AgentAuditEvent[]>([]);
	const [jobInputNodeIds, setJobInputNodeIds] = useState<
		Record<string, string[]>
	>({});
	const [busy, setBusy] = useState("");
	const [message, setMessage] = useState("");
	const intentKeys = useRef(new Map<string, string>());
	const callCanvas = useCallback(
		<T,>(
			action: Parameters<typeof callCanvasRequest>[0],
			input: Record<string, unknown> = {},
			options: Parameters<typeof callCanvasRequest>[2] = {},
		) =>
			callCanvasRequest<T>(action, input, {
				...options,
				signal: requestAbortRef?.current?.signal,
			}),
		[requestAbortRef],
	);
	const agentAdapter = useMemo(
		() => new AgentAdapter(callCanvas),
		[callCanvas],
	);
	const latestRevision = revisions.at(-1) ?? null;
	const selectedSeed =
		CANVAS_PROMPT_SEEDS.find((seed) => seed.id === selectedSeedId) ??
		CANVAS_PROMPT_SEEDS[0];
	const assetNodes = useMemo(
		() =>
			graph?.nodes
				.filter((node) => typeof node.data.assetId === "string")
				.map((node) => ({
					assetId: node.data.assetId as string,
					nodeId: node.id,
					type: node.type,
				})) ?? [],
		[graph],
	);
	const currentCapability = catalog?.operations.find(
		(candidate) => candidate.operation === operation,
	);
	const currentAvailability = honestAvailability(
		operation,
		catalog?.operations ?? [],
	);
	const generationInputBindings = useMemo(
		() =>
			freezeCanvasGenerationInputs({
				allowedInputAssetRoles: currentCapability?.allowedInputAssetRoles ?? [],
				edges: graph?.edges ?? [],
				nodes: graph?.nodes ?? [],
				selectedNodeIds,
			}),
		[currentCapability?.allowedInputAssetRoles, graph, selectedNodeIds],
	);
	const maskAssetId =
		assetNodes.find((node) => node.nodeId === maskNodeId)?.assetId ?? "";
	const generationLineageNodeIds = useMemo(() => {
		return [
			...new Set([
				...generationInputBindings.map((binding) => binding.nodeId),
				...(maskNodeId ? [maskNodeId] : []),
			]),
		];
	}, [generationInputBindings, maskNodeId]);
	const generationInput = useMemo(
		() =>
			project && latestRevision
				? buildCanvasGenerationInput({
						assets: generationInputBindings,
						allowedInputAssetRoles:
							currentCapability?.allowedInputAssetRoles ?? [],
						allowedParameters: currentCapability?.allowedParameters ?? [],
						maskAssetId,
						maskNodeId,
						operation,
						projectId: project.id,
						prompt,
						ratio: selectedSeed.ratio,
						revisionId: latestRevision.id,
					})
				: null,
		[
			generationInputBindings,
			latestRevision,
			maskAssetId,
			maskNodeId,
			operation,
			project,
			prompt,
			selectedSeed.ratio,
			currentCapability?.allowedInputAssetRoles,
			currentCapability?.allowedParameters,
		],
	);
	const generationActions = generationActionState({
		busy: busy !== "",
		catalog: catalog?.operations ?? [],
		hasGenerationInput: generationInput !== null,
		hasPrompt: prompt.trim().length > 0,
		hasQuote: quote !== null,
		operation,
	});
	const generationFingerprint = JSON.stringify({
		input: generationInput,
		inputNodeIds: generationLineageNodeIds,
	});
	const agentFingerprint = agentPlanIntentFingerprint({
		intent: agentIntent,
		maxCostMicros: agentMaxCostMicros,
		maxGenerationCount: agentMaxGenerationCount,
		projectId: project?.id ?? "",
	});
	const previousAgentFingerprint = useRef(agentFingerprint);
	const activityProjectId = runtimeActivityProjectId(project);
	const activityProjectIdRef = useRef(activityProjectId);
	activityProjectIdRef.current = activityProjectId;
	const activityCommitGate = useMemo(
		() => createLatestActivityCommitGate(),
		[],
	);

	const refreshActivity = useCallback(
		async (projectId: string) => {
			if (activityProjectIdRef.current !== projectId) return;
			const canCommit = activityCommitGate.begin(projectId);
			let nextJobs: CoreCanvasGenerationJob[];
			let nextAdoptions: Adoption[];
			try {
				[nextJobs, nextAdoptions] = await Promise.all([
					callCanvas<CoreCanvasGenerationJob[]>("listProjectGenerations", {
						projectId,
					}),
					callCanvas<Adoption[]>("listAdoptions", { projectId }),
				]);
			} catch (error) {
				if (!canCommit() || activityProjectIdRef.current !== projectId) return;
				throw error;
			}
			if (!canCommit() || activityProjectIdRef.current !== projectId) return;
			setJobs(nextJobs);
			setAdoptions(nextAdoptions);
			try {
				const nextAudit = await agentAdapter.listAudit(projectId);
				if (!canCommit() || activityProjectIdRef.current !== projectId) return;
				setAudit(nextAudit);
				setAuditWarning("");
			} catch {
				if (!canCommit() || activityProjectIdRef.current !== projectId) return;
				setAuditWarning("审计记录暂时无法刷新，请稍后重试。");
			}
		},
		[activityCommitGate, agentAdapter, callCanvas],
	);

	useEffect(() => {
		callCanvas<Catalog>("getCatalog")
			.then(setCatalog)
			.catch((error: unknown) => setMessage(runtimeErrorMessage(error)));
	}, [callCanvas]);

	useEffect(() => {
		activityCommitGate.activate(activityProjectId);
		setJobs([]);
		setAdoptions([]);
		setAudit([]);
		setAuditWarning("");
		if (!activityProjectId) {
			return;
		}
		refreshActivity(activityProjectId).catch((error: unknown) =>
			setMessage(runtimeErrorMessage(error)),
		);
		return () => activityCommitGate.invalidate();
	}, [activityCommitGate, activityProjectId, refreshActivity]);

	useEffect(() => {
		onAdoptedNodesChange([
			...new Set(adoptions.flatMap((adoption) => adoption.selectedNodeIds)),
		]);
	}, [adoptions, onAdoptedNodesChange]);

	useEffect(() => {
		if (
			!activityProjectId ||
			!jobs.some((job) =>
				[
					"queued",
					"accepted",
					"delivery_pending",
					"cancel_requested",
					"unknown",
				].includes(job.status),
			)
		)
			return;
		const timer = window.setInterval(() => {
			refreshActivity(activityProjectId).catch((error: unknown) =>
				setMessage(runtimeErrorMessage(error)),
			);
		}, 2_000);
		return () => window.clearInterval(timer);
	}, [activityProjectId, jobs, refreshActivity]);

	useEffect(() => {
		const maskAllowed =
			currentCapability?.allowedInputAssetRoles.includes("mask") === true;
		const imageNodes = new Set(
			assetNodes
				.filter((node) => node.type === "image")
				.map((node) => node.nodeId),
		);
		setMaskNodeId((current) =>
			maskAllowed && imageNodes.has(current) ? current : "",
		);
	}, [assetNodes, currentCapability?.allowedInputAssetRoles]);

	useEffect(() => {
		if (generationFingerprint.length === 0) return;
		setQuote(null);
		intentKeys.current.delete("quote");
		intentKeys.current.delete("submit");
	}, [generationFingerprint]);

	useEffect(() => {
		if (previousAgentFingerprint.current === agentFingerprint) return;
		previousAgentFingerprint.current = agentFingerprint;
		setAgentPlan(null);
		setAgentConfirmations(createAgentOperationConfirmationState(0));
		setCredential(null);
		for (const key of ["agent-plan", "agent-confirm", "agent-apply"]) {
			intentKeys.current.delete(key);
		}
	}, [agentFingerprint]);

	function intentKey(name: string) {
		const existing = intentKeys.current.get(name);
		if (existing) return existing;
		const created = crypto.randomUUID();
		intentKeys.current.set(name, created);
		return created;
	}

	function selectGenerationOperation(next: CanvasGenerationOperation) {
		if (next === operation) return;
		setOperation(next);
		setMaskNodeId("");
	}

	async function run(name: string, action: () => Promise<void>) {
		setBusy(name);
		setMessage("");
		try {
			await action();
		} catch (error) {
			setMessage(runtimeErrorMessage(error));
		} finally {
			setBusy("");
		}
	}

	async function requestQuote() {
		if (!generationInput || !currentAvailability.available) return;
		await run("quote", async () => {
			setQuote(
				await callCanvas<CoreCanvasGenerationQuote>(
					"quoteGeneration",
					generationInput,
					{ idempotencyKey: intentKey("quote") },
				),
			);
			setMessage("报价已固定，可确认提交。若网络重试会复用同一意图键。");
		});
	}

	async function submitGeneration() {
		if (
			!generationInput ||
			!quote ||
			!project ||
			!currentAvailability.available
		)
			return;
		await run("submit", async () => {
			const submitted = await callCanvas<CoreCanvasGenerationJob>(
				"submitGeneration",
				canvasGenerationSubmitPayload(generationInput, quote),
				{ idempotencyKey: intentKey("submit") },
			);
			setJobInputNodeIds((current) => ({
				...current,
				[submitted.jobId]: generationLineageNodeIds,
			}));
			intentKeys.current.delete("submit");
			await refreshActivity(project.id);
			setMessage("生成任务已提交。");
		});
	}

	async function cancel(jobId: string) {
		if (!project) return;
		await run(`cancel:${jobId}`, async () => {
			await callCanvas(
				"cancelGeneration",
				canvasGenerationCancelPayload(project.id, jobId),
				{ idempotencyKey: intentKey(`cancel:${jobId}`) },
			);
			intentKeys.current.delete(`cancel:${jobId}`);
			await refreshActivity(project.id);
			setMessage("已请求取消；等待供应商终态确认。");
		});
	}

	async function adopt() {
		const saved = await persistDraft();
		if (!saved) return;
		await run("adopt", async () => {
			await callCanvas(
				"adoptAdvancedCanvasOutput",
				buildAdoptionInput({
					expectedDraftVersion: saved.draftVersion,
					nodes: saved.graph.nodes,
					projectId: saved.id,
					selectedNodeIds,
					target:
						adoptionTarget === "existing_package"
							? {
									baseVersionId: targetBaseVersionId,
									expectedRevision: targetExpectedRevision,
									kind: "existing_package",
									packageId: targetPackageId,
								}
							: { kind: "new_package" },
				}),
				{ idempotencyKey: intentKey("adopt") },
			);
			intentKeys.current.delete("adopt");
			await refreshActivity(saved.id);
			setMessage("已采用为主产品 ContentPackage。");
		});
	}

	async function planAgent() {
		const saved = await persistDraft();
		if (!saved || !agentIntent.trim()) return;
		await run("agent-plan", async () => {
			const planned = await agentAdapter.plan(
				{
					intent: agentIntent,
					maxCostMicros: agentMaxCostMicros,
					maxGenerationCount: agentMaxGenerationCount,
					projectId: saved.id,
				},
				{ idempotencyKey: intentKey("agent-plan") },
			);
			setAgentPlan(planned);
			setAgentConfirmations(
				createAgentOperationConfirmationState(planned.operations.length),
			);
			setCredential(null);
			intentKeys.current.delete("agent-confirm");
			intentKeys.current.delete("agent-apply");
			setMessage("Agent 计划已生成，请检查真实 diff 后确认。");
		});
	}

	async function confirmAgent() {
		if (!agentPlan || !isAgentPlanFullyConfirmed(agentConfirmations)) return;
		await run("agent-confirm", async () => {
			setCredential(
				await agentAdapter.confirm(
					{ planId: agentPlan.id },
					{ idempotencyKey: intentKey("agent-confirm") },
				),
			);
			setMessage("计划已确认；凭据绑定当前用户、会话、工程与 revision。");
		});
	}

	function rejectCurrentAgentPlan() {
		setAgentConfirmations((current) => rejectAgentPlan(current));
		setAgentPlan(null);
		setCredential(null);
		for (const key of ["agent-confirm", "agent-apply"]) {
			intentKeys.current.delete(key);
		}
		setMessage("已拒绝当前 Agent 计划，未执行任何后端操作。");
	}

	async function applyAgent() {
		if (!agentPlan || !credential || !project) return;
		await run("agent-apply", async () => {
			const outcome = await applyAgentAndRefreshAudit(
				agentAdapter,
				{
					credentialId: credential.credentialId,
					expectedRevision: agentPlan.baseRevision,
					projectId: project.id,
				},
				{ idempotencyKey: intentKey("agent-apply") },
			);
			intentKeys.current.delete("agent-apply");
			if (outcome.audit) setAudit(outcome.audit);
			setAuditWarning(outcome.auditWarning ?? "");
			if (outcome.outcome === "failed") {
				if (outcome.failure.discardCredential) setCredential(null);
				if (outcome.failure.requiresReloadAndReplan) {
					setAgentReloadRequired(true);
					setAgentPlan(null);
					setAgentConfirmations(createAgentOperationConfirmationState(0));
					await onReloadProject(project.id);
					setAgentReloadRequired(false);
				}
				setMessage(outcome.failure.message);
				return;
			}
			setAgentPlan(null);
			setAgentConfirmations(createAgentOperationConfirmationState(0));
			setCredential(null);
			await onReloadProject(project.id);
			try {
				await refreshActivity(project.id);
			} catch {
				setAuditWarning((current) =>
					current
						? `${current} 生成与采用列表也暂时无法刷新。`
						: "生成与采用列表暂时无法刷新，请稍后重试。",
				);
			}
			setMessage(agentApplyResultMessage(outcome.result));
		});
	}

	async function reloadAfterAgentConflict() {
		if (!project) return;
		await run("agent-reload", async () => {
			await onReloadProject(project.id);
			setAgentReloadRequired(false);
			setMessage("工程已重新加载，可以生成新的 Agent 计划。");
		});
	}

	return (
		<aside className="runtime-panel" aria-label="生成、采用与 Agent">
			<section className="runtime-section">
				<div className="runtime-heading">
					<h2>生成能力</h2>
					<span>服务端目录</span>
				</div>
				<div className="capability-grid">
					{catalog?.operations.map((capability) => (
						<button
							className={operation === capability.operation ? "active" : ""}
							key={capability.operation}
							onClick={() => selectGenerationOperation(capability.operation)}
							type="button"
						>
							<strong>{operationLabels[capability.operation]}</strong>
							<small>
								{honestAvailability(capability.operation, catalog.operations)
									.available
									? "可用"
									: "未激活"}
							</small>
						</button>
					))}
				</div>
				{!currentAvailability.available ? (
					<p className="runtime-notice">
						{currentAvailability.reason ?? "该能力尚未通过激活验证。"}
					</p>
				) : null}
				<label>
					<span>美业提示词起点（40 条）</span>
					<select
						value={selectedSeedId}
						onChange={(event) => {
							const seed = CANVAS_PROMPT_SEEDS.find(
								(candidate) => candidate.id === event.target.value,
							);
							if (!seed) return;
							setSelectedSeedId(seed.id);
							selectGenerationOperation(seed.operation);
							setPrompt(seed.prompt);
						}}
					>
						<option disabled value="">
							选择一条产品提供的提示词
						</option>
						{CANVAS_PROMPT_SEEDS.map((seed) => (
							<option key={seed.id} value={seed.id}>
								{seed.group} · {seed.id} · {seed.fileName}
							</option>
						))}
					</select>
				</label>
				{currentCapability?.allowedInputAssetRoles.some(
					(role) => role !== "mask",
				) ? (
					<fieldset className="asset-selection">
						<legend>画布连线输入</legend>
						{generationInputBindings.length > 0 ? (
							generationInputBindings.map((binding) => (
								<small
									data-generation-input-node-id={binding.nodeId}
									key={binding.nodeId}
								>
									画布连线输入：{binding.nodeId}
								</small>
							))
						) : (
							<small>当前有序选区及其连线中没有可用输入素材。</small>
						)}
					</fieldset>
				) : null}
				{operation === "image.edit" &&
				currentCapability?.allowedInputAssetRoles.includes("mask") ? (
					<label>
						<span>蒙版 Asset（可选，独立角色）</span>
						<select
							value={maskNodeId}
							onChange={(event) => setMaskNodeId(event.target.value)}
						>
							<option value="">不使用蒙版</option>
							{assetNodes
								.filter((node) => node.type === "image")
								.map((node) => (
									<option key={node.nodeId} value={node.nodeId}>
										{node.nodeId}
									</option>
								))}
						</select>
					</label>
				) : null}
				<textarea
					placeholder="选择提示词或输入生成指令"
					rows={5}
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
				/>
				<p className="runtime-meta">
					{latestRevision
						? `使用最新检查点 ${latestRevision.label ?? latestRevision.id}`
						: "生成前需在画布工具栏创建检查点"}
				</p>
				<div className="runtime-actions">
					<button
						disabled={generationActions.quoteDisabled}
						onClick={requestQuote}
						type="button"
					>
						获取报价
					</button>
					<button
						disabled={generationActions.submitDisabled}
						onClick={submitGeneration}
						type="button"
					>
						确认提交
					</button>
				</div>
				{quote ? (
					<p className="runtime-meta">
						{currentCapability?.usageAmount ?? 0}{" "}
						{currentCapability?.usageResource ?? "copy"} · 约{" "}
						{currentCapability?.estimatedDurationSeconds.join("–") ?? "--"} 秒 ·
						价格版本 {quote.priceRevision}
					</p>
				) : null}
				<div className="job-list">
					{jobs
						.filter((job) => isGenerationJobForProject(job, activityProjectId))
						.map((job) => {
							const presentation = canvasGenerationJobPresentation(job);
							const inputNodeIds = resolveGenerationJobInputNodeIds(
								job,
								graph?.nodes ?? [],
								jobInputNodeIds[job.jobId] ?? [],
							);
							return (
								<article key={job.jobId}>
									<div>
										<strong>
											{job.operation
												? operationLabels[job.operation]
												: "生成任务"}
										</strong>
										<small>{presentation.statusLabel}</small>
									</div>
									<p className="runtime-meta">
										{presentation.detail}
										{presentation.billingLabel
											? ` · ${presentation.billingLabel}`
											: ""}
									</p>
									{job.deliverable ? (
										<button
											type="button"
											onClick={() => onInsertGenerated(job, inputNodeIds)}
										>
											插入画布
										</button>
									) : isCanvasGenerationCancellable(job.status) ? (
										<button type="button" onClick={() => cancel(job.jobId)}>
											请求取消
										</button>
									) : null}
								</article>
							);
						})}
				</div>
			</section>

			<section className="runtime-section">
				<div className="runtime-heading">
					<h2>采用到主产品</h2>
					<span>{adoptions.length} 次</span>
				</div>
				<p className="runtime-meta">
					仅采用已完成 canonical generation job 的图文或视频节点。
				</p>
				<p className="runtime-meta">
					采用画布当前有序选择：
					{selectedNodeIds.length > 0
						? selectedNodeIds.join(" → ")
						: "尚未选择"}
				</p>
				<label>
					<span>采用目标</span>
					<select
						value={adoptionTarget}
						onChange={(event) =>
							setAdoptionTarget(
								event.target.value as "new_package" | "existing_package",
							)
						}
					>
						<option value="new_package">新建 ContentPackage</option>
						<option value="existing_package">写入现有 ContentPackage</option>
					</select>
				</label>
				{adoptionTarget === "existing_package" ? (
					<div className="adoption-target-fields">
						<input
							placeholder="Package ID"
							value={targetPackageId}
							onChange={(event) => setTargetPackageId(event.target.value)}
						/>
						<input
							placeholder="Base version ID"
							value={targetBaseVersionId}
							onChange={(event) => setTargetBaseVersionId(event.target.value)}
						/>
						<input
							min={0}
							placeholder="Aggregate revision"
							type="number"
							value={targetExpectedRevision}
							onChange={(event) =>
								setTargetExpectedRevision(Number(event.target.value))
							}
						/>
					</div>
				) : null}
				<button
					disabled={
						!project ||
						selectedNodeIds.length === 0 ||
						busy !== "" ||
						(adoptionTarget === "existing_package" &&
							(!targetPackageId.trim() ||
								!targetBaseVersionId.trim() ||
								!Number.isInteger(targetExpectedRevision) ||
								targetExpectedRevision < 0))
					}
					onClick={adopt}
					type="button"
				>
					采用当前生成节点
				</button>
				<div className="adoption-list">
					{adoptions.map((adoption) => (
						<a
							href={packageUrl(mainReturnUrl, adoption.packageId)}
							key={`${adoption.packageId}:${adoption.versionId}`}
						>
							{adoption.packageId} · {adoption.versionId}
						</a>
					))}
				</div>
			</section>

			<section className="runtime-section">
				<div className="runtime-heading">
					<h2>Canvas Agent</h2>
					<span>
						{catalog?.agent.activation === "active" ? "可用" : "未激活"}
					</span>
				</div>
				{catalog?.agent.activation !== "active" ? (
					<p className="runtime-notice">
						{catalog?.agent.reason ?? "Agent planner 尚未配置。"}
					</p>
				) : null}
				<textarea
					placeholder="描述希望 Agent 对画布做出的修改"
					rows={3}
					value={agentIntent}
					onChange={(event) => setAgentIntent(event.target.value)}
				/>
				<div className="agent-limits">
					<label>
						<span>最大成本（μ）</span>
						<input
							min="0"
							type="number"
							value={agentMaxCostMicros}
							onChange={(event) =>
								setAgentMaxCostMicros(
									Math.max(0, Number(event.target.value) || 0),
								)
							}
						/>
					</label>
					<label>
						<span>最大生成数</span>
						<input
							max="20"
							min="0"
							type="number"
							value={agentMaxGenerationCount}
							onChange={(event) =>
								setAgentMaxGenerationCount(
									Math.min(20, Math.max(0, Number(event.target.value) || 0)),
								)
							}
						/>
					</label>
				</div>
				<button
					disabled={
						!project ||
						!agentIntent.trim() ||
						agentReloadRequired ||
						catalog?.agent.activation !== "active" ||
						busy !== ""
					}
					onClick={planAgent}
					type="button"
				>
					生成计划
				</button>
				{agentReloadRequired ? (
					<div className="runtime-notice">
						<p>必须先重新加载最新工程，才能生成新的 Agent 计划。</p>
						<button
							disabled={busy !== ""}
							onClick={reloadAfterAgentConflict}
							type="button"
						>
							重新加载工程
						</button>
					</div>
				) : null}
				{agentPlan ? (
					<div className="agent-plan">
						<strong>待确认真实 diff</strong>
						<ul>
							{agentPlan.operations.map((operation, index) => {
								const change = agentPlan.diff[index];
								return (
									<li key={`${operation.tool}-${index}`}>
										<label>
											<input
												checked={agentConfirmations.confirmed[index] ?? false}
												disabled={busy !== "" || credential !== null}
												onChange={(event) =>
													setAgentConfirmations((current) =>
														setAgentOperationConfirmed(
															current,
															index,
															event.target.checked,
														),
													)
												}
												type="checkbox"
											/>
											确认操作 {index + 1}：{change?.summary ?? operation.tool}
										</label>
										<pre>
											{JSON.stringify(
												{ after: change?.after, before: change?.before },
												null,
												2,
											)}
										</pre>
									</li>
								);
							})}
						</ul>
						<p>
							涉及资产：
							{agentPlan.affectedAssetIds.length > 0
								? agentPlan.affectedAssetIds.join("、")
								: "无"}
						</p>
						<p>
							成本上限 {agentPlan.maxCostMicros} μ · 生成上限{" "}
							{agentPlan.maxGenerationCount}
						</p>
						<div className="runtime-actions">
							<button
								disabled={
									busy !== "" ||
									credential !== null ||
									!isAgentPlanFullyConfirmed(agentConfirmations)
								}
								onClick={confirmAgent}
								type="button"
							>
								确认全部操作
							</button>
							<button
								disabled={busy !== ""}
								onClick={rejectCurrentAgentPlan}
								type="button"
							>
								拒绝计划
							</button>
						</div>
					</div>
				) : null}
				{credential ? (
					<button disabled={busy !== ""} onClick={applyAgent} type="button">
						应用已确认操作
					</button>
				) : null}
				<div className="audit-list">
					{audit.map((event) => (
						<small key={event.id}>
							{event.outcome} · {event.errorCode ?? event.createdAt}
						</small>
					))}
				</div>
				{auditWarning ? (
					<p className="runtime-notice" aria-live="polite">
						{auditWarning}
					</p>
				) : null}
			</section>
			{message ? (
				<p className="runtime-message" aria-live="polite">
					{message}
				</p>
			) : null}
		</aside>
	);
}

export function agentPlanIntentFingerprint(input: {
	intent: string;
	maxCostMicros: number;
	maxGenerationCount: number;
	projectId: string;
}) {
	return JSON.stringify([
		input.projectId,
		input.intent,
		input.maxCostMicros,
		input.maxGenerationCount,
	]);
}

export function runtimeActivityProjectId(
	project: { id: string } | null | undefined,
) {
	return project?.id ?? null;
}

export function createLatestActivityCommitGate() {
	let latestRequest = 0;
	let activeProjectId: string | null = null;
	return {
		activate(projectId: string | null) {
			activeProjectId = projectId;
			latestRequest += 1;
		},
		begin(projectId: string) {
			const request = ++latestRequest;
			return () => projectId === activeProjectId && request === latestRequest;
		},
		invalidate() {
			activeProjectId = null;
			latestRequest += 1;
		},
	};
}

export function isGenerationJobForProject(
	job: Pick<CoreCanvasGenerationJob, "projectId">,
	projectId: string | null,
) {
	return projectId !== null && job.projectId === projectId;
}

export function generationActionState(input: {
	busy: boolean;
	catalog: CatalogEntry[];
	hasGenerationInput: boolean;
	hasPrompt: boolean;
	hasQuote: boolean;
	operation: string;
}) {
	const availability = honestAvailability(input.operation, input.catalog);
	const quoteDisabled =
		input.busy ||
		!availability.available ||
		!input.hasGenerationInput ||
		!input.hasPrompt;
	return {
		availability,
		quoteDisabled,
		submitDisabled: quoteDisabled || !input.hasQuote,
	};
}

export function agentApplyResultMessage(input: {
	status: "changed" | "error" | "executed";
}) {
	switch (input.status) {
		case "changed":
			return "Agent 已应用变更并更新画布 revision。";
		case "executed":
			return "Agent 已执行；画布内容未发生变更。";
		case "error":
			return "Agent 操作未应用，请检查后重试。";
	}
}

function packageUrl(mainReturnUrl: string, packageId: string) {
	const url = new URL("/dashboard/content", mainReturnUrl);
	url.searchParams.set("packageId", packageId);
	return url.href;
}

export function runtimeErrorMessage(error: unknown) {
	if (!(error instanceof Error)) return "操作失败，请重试。";
	switch (error.message) {
		case "ADOPTION_SELECTION_AUDIO_UNSUPPORTED":
			return "暂不支持单独采用音频节点。请选择图文或视频节点。";
		case "ADOPTION_SELECTION_CANONICAL_JOB_REQUIRED":
			return "只能采用已完成生成并绑定正式任务的媒体节点。";
		case "ADOPTION_SELECTION_EMPTY":
			return "请先在画布中选择要采用的图片或视频节点。";
		case "ADOPTION_SELECTION_MEDIA_MIXED":
			return "一次只能采用同一种媒体：请选择纯图片组或纯视频组。";
		case "ADOPTION_SELECTION_TEXT_REQUIRED":
			return "采用图片时还需要在画布中选择一个非空文本节点。";
		case "ADOPTION_SELECTION_VIDEO_TEXT_UNSUPPORTED":
			return "采用视频时请只选择视频节点，不要同时选择文本节点。";
		default:
			return error.message;
	}
}

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
import { callCanvas as callCanvasRequest } from "./backend-client";
import {
	buildCanvasGenerationInput,
	type CoreCanvasGenerationJob,
	type CoreCanvasGenerationQuote,
	canvasGenerationCancelPayload,
	canvasGenerationSubmitPayload,
	isCanvasGenerationCancellable,
} from "./generation-ui-contract";
import { CANVAS_PROMPT_SEEDS } from "./prompt-seeds";

interface RuntimePanelProps {
	mainReturnUrl: string;
	onAdoptedNodesChange(nodeIds: string[]): void;
	onInsertGenerated(job: CoreCanvasGenerationJob): void;
	onReloadProject(projectId: string): Promise<void>;
	persistDraft(): Promise<AdvancedCanvasProject | null>;
	project: AdvancedCanvasProject | null;
	requestAbortRef?: { current: AbortController | null };
	revisions: AdvancedCanvasRevision[];
}

type Catalog = {
	agent: { activation: "active" | "inactive"; reason?: string };
	operations: Array<
		CanvasGenerationCatalogEntry & { unavailableReason?: string }
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

type AgentCredential = {
	affectedAssetIds: string[];
	credentialId: string;
	diff: AgentPlan["diff"];
	expiresAt: string;
	maxCostMicros: number;
	maxGenerationCount: number;
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
	mainReturnUrl,
	onAdoptedNodesChange,
	onInsertGenerated,
	onReloadProject,
	persistDraft,
	project,
	requestAbortRef,
	revisions,
}: RuntimePanelProps) {
	const [catalog, setCatalog] = useState<Catalog | null>(null);
	const [operation, setOperation] =
		useState<CanvasGenerationOperation>("image.generate");
	const [prompt, setPrompt] = useState("");
	const [selectedSeedId, setSelectedSeedId] = useState("");
	const [inputAssetIds, setInputAssetIds] = useState<string[]>([]);
	const [maskAssetId, setMaskAssetId] = useState("");
	const [quote, setQuote] = useState<CoreCanvasGenerationQuote | null>(null);
	const [jobs, setJobs] = useState<CoreCanvasGenerationJob[]>([]);
	const [adoptions, setAdoptions] = useState<Adoption[]>([]);
	const [adoptionMediaNodeIds, setAdoptionMediaNodeIds] = useState<string[]>(
		[],
	);
	const [adoptionTextNodeId, setAdoptionTextNodeId] = useState("");
	const [adoptionTarget, setAdoptionTarget] = useState<
		"new_package" | "existing_package"
	>("new_package");
	const [targetPackageId, setTargetPackageId] = useState("");
	const [targetBaseVersionId, setTargetBaseVersionId] = useState("");
	const [agentIntent, setAgentIntent] = useState("");
	const [agentMaxCostMicros, setAgentMaxCostMicros] = useState(0);
	const [agentMaxGenerationCount, setAgentMaxGenerationCount] = useState(0);
	const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
	const [credential, setCredential] = useState<AgentCredential | null>(null);
	const [audit, setAudit] = useState<AgentAuditEvent[]>([]);
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
	const latestRevision = revisions.at(-1) ?? null;
	const selectedSeed =
		CANVAS_PROMPT_SEEDS.find((seed) => seed.id === selectedSeedId) ??
		CANVAS_PROMPT_SEEDS[0];
	const assetNodes = useMemo(
		() =>
			project?.graph.nodes
				.filter((node) => typeof node.data.assetId === "string")
				.map((node) => ({
					assetId: node.data.assetId as string,
					nodeId: node.id,
					type: node.type,
				})) ?? [],
		[project],
	);
	const currentCapability = catalog?.operations.find(
		(candidate) => candidate.operation === operation,
	);
	const adoptableNodes = useMemo(
		() =>
			project?.graph.nodes.filter(
				(node) =>
					(node.type === "image" || node.type === "video") &&
					typeof node.data.assetId === "string" &&
					typeof node.data.jobId === "string",
			) ?? [],
		[project],
	);
	const textNodes = useMemo(
		() =>
			project?.graph.nodes.filter(
				(node) => node.type === "text" && typeof node.data.text === "string",
			) ?? [],
		[project],
	);
	const generationInput = useMemo(
		() =>
			project && latestRevision
				? buildCanvasGenerationInput({
						assets: assetNodes
							.filter((asset) => inputAssetIds.includes(asset.assetId))
							.map((asset) => ({
								assetId: asset.assetId,
								nodeType: asset.type,
							})),
						allowedParameters: currentCapability?.allowedParameters ?? [],
						maskAssetId,
						operation,
						projectId: project.id,
						prompt,
						ratio: selectedSeed.ratio,
						revisionId: latestRevision.id,
					})
				: null,
		[
			assetNodes,
			inputAssetIds,
			latestRevision,
			maskAssetId,
			operation,
			project,
			prompt,
			selectedSeed.ratio,
			currentCapability?.allowedParameters,
		],
	);
	const generationFingerprint = JSON.stringify(generationInput);
	const agentFingerprint = agentPlanIntentFingerprint({
		intent: agentIntent,
		maxCostMicros: agentMaxCostMicros,
		maxGenerationCount: agentMaxGenerationCount,
		projectId: project?.id ?? "",
	});
	const previousAgentFingerprint = useRef(agentFingerprint);

	const refreshActivity = useCallback(
		async (projectId: string) => {
			const [nextJobs, nextAdoptions, nextAudit] = await Promise.all([
				callCanvas<CoreCanvasGenerationJob[]>("listProjectGenerations", {
					projectId,
				}),
				callCanvas<Adoption[]>("listAdoptions", { projectId }),
				callCanvas<AgentAuditEvent[]>("listAgentAudit", { projectId }),
			]);
			setJobs(nextJobs);
			setAdoptions(nextAdoptions);
			setAudit(nextAudit);
		},
		[callCanvas],
	);

	useEffect(() => {
		callCanvas<Catalog>("getCatalog")
			.then(setCatalog)
			.catch((error: unknown) => setMessage(errorMessage(error)));
	}, [callCanvas]);

	useEffect(() => {
		if (!project) {
			setJobs([]);
			setAdoptions([]);
			setAudit([]);
			return;
		}
		refreshActivity(project.id).catch((error: unknown) =>
			setMessage(errorMessage(error)),
		);
	}, [project?.id, project, refreshActivity]);

	useEffect(() => {
		onAdoptedNodesChange([
			...new Set(adoptions.flatMap((adoption) => adoption.selectedNodeIds)),
		]);
	}, [adoptions, onAdoptedNodesChange]);

	useEffect(() => {
		if (
			!project ||
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
			refreshActivity(project.id).catch((error: unknown) =>
				setMessage(errorMessage(error)),
			);
		}, 2_000);
		return () => window.clearInterval(timer);
	}, [jobs, project, refreshActivity]);

	useEffect(() => {
		const available = new Set(assetNodes.map((node) => node.assetId));
		setInputAssetIds((current) => current.filter((id) => available.has(id)));
		setMaskAssetId((current) => (available.has(current) ? current : ""));
	}, [assetNodes]);

	useEffect(() => {
		const availableMedia = new Set(adoptableNodes.map((node) => node.id));
		const availableText = new Set(textNodes.map((node) => node.id));
		setAdoptionMediaNodeIds((current) =>
			current.filter((id) => availableMedia.has(id)),
		);
		setAdoptionTextNodeId((current) =>
			availableText.has(current) ? current : "",
		);
	}, [adoptableNodes, textNodes]);

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

	async function run(name: string, action: () => Promise<void>) {
		setBusy(name);
		setMessage("");
		try {
			await action();
		} catch (error) {
			setMessage(errorMessage(error));
		} finally {
			setBusy("");
		}
	}

	async function requestQuote() {
		if (!generationInput) return;
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
		if (!generationInput || !quote || !project) return;
		await run("submit", async () => {
			await callCanvas(
				"submitGeneration",
				canvasGenerationSubmitPayload(generationInput, quote),
				{ idempotencyKey: intentKey("submit") },
			);
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
		const mediaNodes = saved.graph.nodes.filter(
			(node) =>
				adoptionMediaNodeIds.includes(node.id) &&
				(node.type === "image" || node.type === "video") &&
				typeof node.data.assetId === "string" &&
				typeof node.data.jobId === "string",
		);
		const mediaType = mediaNodes[0]?.type;
		const orderedMediaNodeIds = mediaNodes
			.filter((node) => node.type === mediaType)
			.map((node) => node.id);
		const textNodeId = adoptionTextNodeId || undefined;
		if (
			orderedMediaNodeIds.length === 0 ||
			(mediaType === "image" && !textNodeId)
		) {
			setMessage("采用需要已完成生成的媒体节点；图文采用还需要一个文本节点。");
			return;
		}
		await run("adopt", async () => {
			await callCanvas(
				"adoptAdvancedCanvasOutput",
				{
					projectId: saved.id,
					revisionRef: {
						expectedDraftVersion: saved.draftVersion,
						kind: "freeze_current_draft",
					},
					selection: {
						orderedMediaNodeIds,
						...(mediaType === "image" ? { textNodeId } : {}),
					},
					target:
						adoptionTarget === "existing_package"
							? {
									baseVersionId: targetBaseVersionId,
									kind: "existing_package",
									packageId: targetPackageId,
								}
							: { kind: "new_package" },
				},
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
			const planned = await callCanvas<AgentPlan>(
				"planAgent",
				{
					intent: agentIntent,
					maxCostMicros: agentMaxCostMicros,
					maxGenerationCount: agentMaxGenerationCount,
					projectId: saved.id,
				},
				{ idempotencyKey: intentKey("agent-plan") },
			);
			setAgentPlan(planned);
			setCredential(null);
			intentKeys.current.delete("agent-confirm");
			intentKeys.current.delete("agent-apply");
			setMessage("Agent 计划已生成，请检查真实 diff 后确认。");
		});
	}

	async function confirmAgent() {
		if (!agentPlan) return;
		await run("agent-confirm", async () => {
			setCredential(
				await callCanvas<AgentCredential>(
					"confirmAgent",
					{ planId: agentPlan.id },
					{ idempotencyKey: intentKey("agent-confirm") },
				),
			);
			setMessage("计划已确认；凭据绑定当前用户、会话、工程与 revision。");
		});
	}

	async function applyAgent() {
		if (!agentPlan || !credential || !project) return;
		await run("agent-apply", async () => {
			const result = await callCanvas<{
				status: "changed" | "error" | "executed";
			}>(
				"applyAgentOps",
				{
					credentialId: credential.credentialId,
					expectedRevision: agentPlan.baseRevision,
					projectId: project.id,
				},
				{ idempotencyKey: intentKey("agent-apply") },
			);
			intentKeys.current.delete("agent-apply");
			setMessage(agentApplyResultMessage(result));
			if (result.status === "error") return;
			setAgentPlan(null);
			setCredential(null);
			await onReloadProject(project.id);
			await refreshActivity(project.id);
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
							onClick={() => setOperation(capability.operation)}
							type="button"
						>
							<strong>{operationLabels[capability.operation]}</strong>
							<small>
								{capability.activation === "active" ? "可用" : "未激活"}
							</small>
						</button>
					))}
				</div>
				{currentCapability?.activation === "inactive" ? (
					<p className="runtime-notice">
						{currentCapability.unavailableReason ?? "该能力尚未通过激活验证。"}
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
							setOperation(seed.operation);
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
				{operation !== "image.generate" && assetNodes.length > 0 ? (
					<fieldset className="asset-selection">
						<legend>输入素材节点（显式选择）</legend>
						{assetNodes.map((node) => (
							<label key={node.nodeId}>
								<input
									checked={inputAssetIds.includes(node.assetId)}
									onChange={(event) =>
										setInputAssetIds((current) =>
											event.target.checked
												? [...current, node.assetId]
												: current.filter((id) => id !== node.assetId),
										)
									}
									type="checkbox"
								/>
								{node.type} · {node.nodeId}
							</label>
						))}
					</fieldset>
				) : null}
				{operation === "image.edit" ? (
					<label>
						<span>蒙版 Asset（可选，独立角色）</span>
						<select
							value={maskAssetId}
							onChange={(event) => setMaskAssetId(event.target.value)}
						>
							<option value="">不使用蒙版</option>
							{assetNodes.map((node) => (
								<option key={node.nodeId} value={node.assetId}>
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
						disabled={
							busy !== "" ||
							!generationInput ||
							!prompt.trim() ||
							currentCapability?.activation !== "active"
						}
						onClick={requestQuote}
						type="button"
					>
						获取报价
					</button>
					<button
						disabled={busy !== "" || !quote}
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
					{jobs.map((job) => (
						<article key={job.jobId}>
							<div>
								<strong>
									{job.operation ? operationLabels[job.operation] : "生成任务"}
								</strong>
								<small>{job.status}</small>
							</div>
							{job.deliverable ? (
								<button type="button" onClick={() => onInsertGenerated(job)}>
									插入画布
								</button>
							) : isCanvasGenerationCancellable(job.status) ? (
								<button type="button" onClick={() => cancel(job.jobId)}>
									请求取消
								</button>
							) : null}
						</article>
					))}
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
				<fieldset className="asset-selection">
					<legend>生成媒体节点</legend>
					{adoptableNodes.map((node) => (
						<label key={node.id}>
							<input
								checked={adoptionMediaNodeIds.includes(node.id)}
								onChange={(event) =>
									setAdoptionMediaNodeIds((current) =>
										event.target.checked
											? [...current, node.id]
											: current.filter((id) => id !== node.id),
									)
								}
								type="checkbox"
							/>
							{node.type} · {node.id}
						</label>
					))}
				</fieldset>
				<label>
					<span>图文文本节点</span>
					<select
						value={adoptionTextNodeId}
						onChange={(event) => setAdoptionTextNodeId(event.target.value)}
					>
						<option value="">不选择</option>
						{textNodes.map((node) => (
							<option key={node.id} value={node.id}>
								{node.id}
							</option>
						))}
					</select>
				</label>
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
					</div>
				) : null}
				<button
					disabled={
						!project ||
						adoptionMediaNodeIds.length === 0 ||
						busy !== "" ||
						(adoptionTarget === "existing_package" &&
							(!targetPackageId.trim() || !targetBaseVersionId.trim()))
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
						catalog?.agent.activation !== "active" ||
						busy !== ""
					}
					onClick={planAgent}
					type="button"
				>
					生成计划
				</button>
				{agentPlan ? (
					<div className="agent-plan">
						<strong>待确认真实 diff</strong>
						<ul>
							{agentPlan.diff.map((change, index) => (
								<li key={`${change.tool}-${index}`}>
									<strong>{change.summary}</strong>
									<pre>
										{JSON.stringify(
											{ after: change.after, before: change.before },
											null,
											2,
										)}
									</pre>
								</li>
							))}
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
						<button disabled={busy !== ""} onClick={confirmAgent} type="button">
							确认计划
						</button>
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

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "操作失败，请重试。";
}

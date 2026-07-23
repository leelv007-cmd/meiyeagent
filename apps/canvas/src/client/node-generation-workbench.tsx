"use client";

import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasGenerationFanOutQuoteProjection } from "./generation-batch-orchestrator";
import {
	buildCanvasGenerationInput,
	type CanvasGenerationParameterValue,
	type CanvasGenerationRequest,
	type CoreCanvasGenerationJob,
} from "./generation-ui-contract";
import {
	applyCanvasGenerationBatchJobUpdate,
	type CanvasGenerationBackendRequest,
	type CanvasGenerationBatchSnapshot,
	type CanvasGenerationCatalog,
	type CanvasGenerationContextNodeKind,
	cancelCanvasGeneration,
	canvasGenerationAvailability,
	canvasGenerationBatchSnapshotSummary,
	canvasGenerationFailureMessage,
	canvasGenerationJobView,
	canvasNodeGenerationActions,
	createCanvasGenerationBatchSnapshot,
	defaultCanvasGenerationParameterValues,
	defaultCanvasNodeGenerationOperation,
	invalidCanvasGenerationParameters,
	quoteCanvasGenerationBatch,
	reconcileCanvasGenerationBatchJobs,
	retryCanvasGeneration,
	selectCanvasGenerationBatchPrimary,
	submitCanvasGenerationBatch,
	visibleCanvasGenerationParameterControls,
} from "./node-generation-contract";
import type { CanvasTextStreamProgress } from "./node-generation-persistence";
import {
	type CanvasAssetListItem,
	type CanvasCursorPage,
	mentionedGenerationInputs,
	type ResourceDraft,
	type ResourceMentionCandidate,
} from "./resource-workflow";
import { ResourceMentionComposer } from "./resource-workflow-ui";

export type CanvasNodeGenerationContext = {
	kind: CanvasGenerationContextNodeKind;
};

export type CanvasNodeGenerationSubmittedItem = {
	input: CanvasGenerationRequest;
	job: CoreCanvasGenerationJob;
};

type CanvasGenerationResourceNode = {
	data: Record<string, unknown>;
	id: string;
	type: string;
};

export type CanvasNodeGenerationWorkbenchProps = {
	/** Host-owned JSON-safe state; persist it with the existing project/job view. */
	batchSnapshot: CanvasGenerationBatchSnapshot | null;
	batchKey?: string;
	catalog: CanvasGenerationCatalog | null;
	context: CanvasNodeGenerationContext;
	jobs?: readonly CoreCanvasGenerationJob[];
	loadAssets(input: {
		cursor?: string;
		kind?: "audio" | "image" | "video";
		query?: string;
	}): Promise<CanvasCursorPage<CanvasAssetListItem>>;
	onClose?(): void;
	onJobsSubmitted?(jobs: CoreCanvasGenerationJob[]): void;
	onJobUpdated?(job: CoreCanvasGenerationJob): void;
	onPrimaryJobChange?(jobId: string): void;
	onBatchSnapshotChange(
		snapshot: CanvasGenerationBatchSnapshot,
	): void | Promise<void>;
	onResourceDraftChange(draft: ResourceDraft): void;
	onResumeTextGeneration?(job: CoreCanvasGenerationJob): void;
	onTextGenerationSubmitted?(
		items: readonly CanvasNodeGenerationSubmittedItem[],
	): void | Promise<void>;
	prepareQuoteCheckpoint(
		operation: CanvasGenerationOperation,
	): Promise<{ projectId: string; revisionId: string }>;
	request: CanvasGenerationBackendRequest;
	resourceDraft: ResourceDraft;
	resourceNodeCandidates: readonly ResourceMentionCandidate[];
	resourceNodes: readonly CanvasGenerationResourceNode[];
	textStreams?: readonly CanvasTextStreamProgress[];
};

/**
 * Standalone node/config generation surface. The Canvas shell mounts it after
 * the K2/K3 interaction work is available; it deliberately owns no polling,
 * text streaming, fake job, or batch persistence state.
 */
export function CanvasNodeGenerationWorkbench({
	batchSnapshot,
	batchKey,
	catalog,
	context,
	jobs = [],
	loadAssets,
	onClose,
	onBatchSnapshotChange,
	onJobsSubmitted,
	onJobUpdated,
	onPrimaryJobChange,
	onResourceDraftChange,
	onResumeTextGeneration,
	onTextGenerationSubmitted,
	prepareQuoteCheckpoint,
	request,
	resourceDraft,
	resourceNodeCandidates,
	resourceNodes,
	textStreams = [],
}: CanvasNodeGenerationWorkbenchProps) {
	const actions = canvasNodeGenerationActions(context.kind);
	const operation = actions.some(
		(action) => action.operation === resourceDraft.operation,
	)
		? resourceDraft.operation
		: defaultCanvasNodeGenerationOperation(context.kind);
	const [modelId, setModelId] = useState("");
	const [parameterValues, setParameterValues] = useState<
		Record<string, CanvasGenerationParameterValue>
	>(() => defaultCanvasGenerationParameterValues(operation));
	const [count, setCount] = useState(1);
	const [maskNodeId, setMaskNodeId] = useState("");
	const [quotes, setQuotes] =
		useState<CanvasGenerationFanOutQuoteProjection | null>(null);
	const [busy, setBusy] = useState<
		"" | "cancel" | "quote" | "retry" | "submit"
	>("");
	const [message, setMessage] = useState("");
	const batchKeyRef = useRef(batchKey ?? createCanvasBatchKey());
	const availability = useMemo(
		() =>
			canvasGenerationAvailability({
				catalog,
				modelId,
				operation,
			}),
		[catalog, modelId, operation],
	);
	const selectedModelId =
		modelId || availability.modelChoices[0]?.modelId || "";
	const selectedModelIndex = Math.max(
		0,
		availability.modelChoices.findIndex(
			(choice) => choice.modelId === selectedModelId,
		),
	);
	const controls = visibleCanvasGenerationParameterControls({
		allowedParameters: availability.capability?.allowedParameters ?? [],
		operation,
	});
	const invalidParameters = invalidCanvasGenerationParameters({
		allowedParameters: availability.capability?.allowedParameters ?? [],
		operation,
		values: parameterValues,
	});
	const mentionedInputs = useMemo(
		() =>
			mentionedGenerationInputs({
				allowedInputAssetRoles:
					availability.capability?.allowedInputAssetRoles ?? [],
				mentions: resourceDraft.mentions,
				nodes: resourceNodes,
			}).filter((asset) => Boolean(asset.nodeId)),
		[
			availability.capability?.allowedInputAssetRoles,
			resourceDraft.mentions,
			resourceNodes,
		],
	);
	const hasUnboundAssetMention = resourceDraft.mentions.some(
		(mention) => mention.kind === "asset",
	);
	const imageMentionOptions = useMemo(
		() =>
			resourceDraft.mentions.flatMap((mention) => {
				if (
					mention.kind !== "node" ||
					mention.mediaKind !== "image" ||
					!mention.nodeId ||
					!mentionedInputs.some((input) => input.nodeId === mention.nodeId)
				)
					return [];
				return [
					{
						assetId: mention.assetId,
						label: mention.label,
						nodeId: mention.nodeId,
					},
				];
			}),
		[mentionedInputs, resourceDraft.mentions],
	);
	const maskAssetId =
		mentionedInputs.find(
			(input) => input.nodeType === "image" && input.nodeId === maskNodeId,
		)?.assetId ?? "";

	useEffect(() => {
		const nextModel = availability.modelChoices[0]?.modelId ?? "";
		setModelId((current) =>
			availability.modelChoices.some((choice) => choice.modelId === current)
				? current
				: nextModel,
		);
	}, [availability.modelChoices]);

	useEffect(() => {
		setParameterValues(defaultCanvasGenerationParameterValues(operation));
		setMaskNodeId("");
		setQuotes(null);
		setMessage("");
		batchKeyRef.current = batchKey ?? createCanvasBatchKey();
		// Changing operation changes every strict parameter field and quote input.
	}, [batchKey, operation]);

	function clearIntent() {
		setQuotes(null);
		setMessage("");
		batchKeyRef.current = batchKey ?? createCanvasBatchKey();
	}

	function chooseOperation(nextOperation: CanvasGenerationOperation) {
		if (nextOperation === operation) return;
		onResourceDraftChange({ ...resourceDraft, operation: nextOperation });
	}

	function changeParameter(
		name: string,
		value: CanvasGenerationParameterValue,
	) {
		setParameterValues((current) => ({ ...current, [name]: value }));
		clearIntent();
	}

	function buildInput(checkpoint: { projectId: string; revisionId: string }) {
		if (
			!availability.available ||
			!availability.capability ||
			!selectedModelId
		) {
			return null;
		}
		if (
			!resourceDraft.prompt.trim() ||
			invalidParameters.length > 0 ||
			hasUnboundAssetMention
		)
			return null;
		const assets = mentionedInputs.filter(
			(asset) => asset.nodeId !== maskNodeId || operation !== "image.edit",
		);
		return buildCanvasGenerationInput({
			allowedInputAssetRoles: availability.capability.allowedInputAssetRoles,
			allowedParameters: availability.capability.allowedParameters,
			assets,
			maskAssetId: operation === "image.edit" ? maskAssetId : "",
			maskNodeId: operation === "image.edit" ? maskNodeId : "",
			modelId: selectedModelId,
			operation,
			parameterValues,
			projectId: checkpoint.projectId,
			prompt: resourceDraft.prompt,
			ratio:
				typeof parameterValues.ratio === "string"
					? parameterValues.ratio
					: "1:1",
			revisionId: checkpoint.revisionId,
		});
	}

	async function requestQuote() {
		if (
			!availability.available ||
			!resourceDraft.prompt.trim() ||
			invalidParameters.length > 0 ||
			hasUnboundAssetMention ||
			count < 1 ||
			count > 15
		)
			return;
		setBusy("quote");
		setMessage("");
		try {
			const checkpoint = await prepareQuoteCheckpoint(operation);
			const input = buildInput(checkpoint);
			if (!input) throw new Error("CANVAS_GENERATION_INPUT_REQUIRED");
			const nextQuotes = await quoteCanvasGenerationBatch(request, {
				batchKey: batchKeyRef.current,
				count,
				input,
			});
			setQuotes(nextQuotes);
			setMessage(
				nextQuotes.canConfirm
					? "报价已汇总，请确认后提交。"
					: "部分报价未成功，尚不能提交。",
			);
		} catch {
			setMessage("报价暂时不可用，请稍后重试。");
		} finally {
			setBusy("");
		}
	}

	async function confirmSubmission() {
		if (!quotes?.canConfirm) return;
		setBusy("submit");
		setMessage("");
		try {
			const nextSubmission = await submitCanvasGenerationBatch(request, quotes);
			const nextSnapshot = createCanvasGenerationBatchSnapshot({
				quotes,
				submission: nextSubmission,
			});
			await onBatchSnapshotChange(nextSnapshot);
			const jobs = nextSubmission.items.flatMap((item) =>
				item.state === "submitted" && item.job ? [item.job] : [],
			);
			onJobsSubmitted?.(jobs);
			await onTextGenerationSubmitted?.(
				nextSnapshot.items.flatMap((item) =>
					item.state === "submitted" &&
					item.job &&
					item.input.operation === "text.respond"
						? [{ input: item.input, job: item.job }]
						: [],
				),
			);
			setMessage("已逐项提交生成任务。结果会以服务端任务状态为准。 ");
		} catch {
			setMessage("提交未完成，请稍后重试。");
		} finally {
			setBusy("");
		}
	}

	async function retry(job: CoreCanvasGenerationJob) {
		setBusy("retry");
		setMessage("");
		try {
			const updated = await retryCanvasGeneration(request, {
				idempotencyKey: createCanvasIntentKey("retry"),
				jobId: job.jobId,
				projectId: job.projectId,
			});
			if (batchSnapshot) {
				const nextSnapshot = applyCanvasGenerationBatchJobUpdate({
					job: updated,
					previousJobId: job.jobId,
					snapshot: reconcileCanvasGenerationBatchJobs(batchSnapshot, jobs),
				});
				await onBatchSnapshotChange(nextSnapshot);
				const textItem = nextSnapshot.items.find(
					(item) =>
						item.job?.jobId === updated.jobId &&
						item.input.operation === "text.respond",
				);
				if (textItem?.job) {
					await onTextGenerationSubmitted?.([
						{ input: textItem.input, job: textItem.job },
					]);
				}
			}
			onJobUpdated?.(updated);
			setMessage("已请求重新生成。任务状态将由服务端确认。 ");
		} catch {
			setMessage("暂时无法重新生成，请稍后重试。");
		} finally {
			setBusy("");
		}
	}

	async function cancel(job: CoreCanvasGenerationJob) {
		setBusy("cancel");
		setMessage("");
		try {
			const updated = await cancelCanvasGeneration(request, {
				idempotencyKey: createCanvasIntentKey("cancel"),
				jobId: job.jobId,
				projectId: job.projectId,
			});
			if (batchSnapshot) {
				await onBatchSnapshotChange(
					applyCanvasGenerationBatchJobUpdate({
						job: updated,
						previousJobId: job.jobId,
						snapshot: reconcileCanvasGenerationBatchJobs(batchSnapshot, jobs),
					}),
				);
			}
			onJobUpdated?.(updated);
			setMessage("已请求取消，等待服务端确认。 ");
		} catch {
			setMessage("暂时无法取消，请稍后重试。");
		} finally {
			setBusy("");
		}
	}

	const canQuote =
		availability.available &&
		resourceDraft.prompt.trim().length > 0 &&
		invalidParameters.length === 0 &&
		!hasUnboundAssetMention &&
		count >= 1 &&
		count <= 15 &&
		busy === "";

	return (
		<section aria-label="节点生成" className="node-generation-workbench">
			<header className="node-generation-workbench__header">
				<div>
					<h3>{context.kind === "config" ? "生成配置" : "节点生成"}</h3>
					<p>当前选中节点及其相连资源可被引用；仅会提交明确引用的画布素材。</p>
				</div>
				{onClose ? (
					<button aria-label="关闭生成面板" onClick={onClose} type="button">
						关闭
					</button>
				) : null}
			</header>

			<fieldset className="node-generation-workbench__actions">
				<legend>生成方式</legend>
				{actions.map((action) => (
					<button
						aria-pressed={operation === action.operation}
						key={action.operation}
						onClick={() => chooseOperation(action.operation)}
						type="button"
					>
						{action.label}
					</button>
				))}
			</fieldset>

			<label>
				<span>模型</span>
				<select
					disabled={
						!availability.available && availability.modelChoices.length === 0
					}
					onChange={(event) => {
						setModelId(
							availability.modelChoices[Number(event.target.value)]?.modelId ??
								"",
						);
						clearIntent();
					}}
					value={String(selectedModelIndex)}
				>
					{availability.modelChoices.map((choice, index) => (
						<option key={choice.modelId} value={String(index)}>
							{choice.label}
						</option>
					))}
				</select>
			</label>
			{availability.available ? null : <output>{availability.reason}</output>}

			{operation === "image.edit" &&
			availability.capability?.allowedInputAssetRoles.includes("mask") ? (
				<label>
					<span>蒙版（可选）</span>
					<select
						onChange={(event) => {
							setMaskNodeId(event.target.value);
							clearIntent();
						}}
						value={maskNodeId}
					>
						<option value="">不使用蒙版</option>
						{imageMentionOptions.map((option) => (
							<option key={option.nodeId} value={option.nodeId}>
								@{option.label}
							</option>
						))}
					</select>
				</label>
			) : null}

			<ResourceMentionComposer
				disabled={busy !== ""}
				draft={resourceDraft}
				loadAssets={loadAssets}
				nodeCandidates={resourceNodeCandidates}
				onChange={(nextDraft) => {
					onResourceDraftChange(nextDraft);
					clearIntent();
				}}
			/>
			{hasUnboundAssetMention ? (
				<p role="alert">素材需先插入画布并从连线节点引用，才能生成。</p>
			) : null}

			{controls.length > 0 ? (
				<fieldset className="node-generation-workbench__parameters">
					<legend>生成设置</legend>
					{controls.map((control) => (
						<CanvasGenerationParameterField
							control={control}
							key={control.name}
							onChange={changeParameter}
							value={parameterValues[control.name]}
						/>
					))}
				</fieldset>
			) : null}
			{invalidParameters.length > 0 ? (
				<p role="alert">请修正当前模型支持的生成参数。</p>
			) : null}

			<label>
				<span>生成数量</span>
				<input
					max={15}
					min={1}
					onChange={(event) => {
						setCount(Number(event.target.value));
						clearIntent();
					}}
					type="number"
					value={count}
				/>
				<small>每项独立报价与提交，最多 15 项。</small>
			</label>

			<div className="node-generation-workbench__submit">
				<button disabled={!canQuote} onClick={requestQuote} type="button">
					{busy === "quote" ? "正在获取报价" : `获取 ${count} 项报价`}
				</button>
				{quotes?.canConfirm ? (
					<button
						disabled={busy !== ""}
						onClick={confirmSubmission}
						type="button"
					>
						{busy === "submit"
							? "正在逐项提交"
							: `确认提交 ${quotes.items.length} 项`}
					</button>
				) : null}
			</div>

			{quotes ? <CanvasGenerationQuoteSummary quotes={quotes} /> : null}
			{batchSnapshot ? (
				<CanvasGenerationBatchStack
					disabled={busy !== ""}
					jobs={jobs}
					onCancel={cancel}
					onSnapshotChange={onBatchSnapshotChange}
					onPrimaryJobChange={onPrimaryJobChange}
					onResumeTextGeneration={onResumeTextGeneration}
					onRetry={retry}
					snapshot={batchSnapshot}
					textStreams={textStreams}
				/>
			) : null}
			{message ? <p aria-live="polite">{message}</p> : null}
		</section>
	);
}

export function CanvasGenerationBatchStack({
	disabled,
	jobs,
	onCancel,
	onSnapshotChange,
	onPrimaryJobChange,
	onResumeTextGeneration,
	onRetry,
	snapshot,
	textStreams,
}: {
	disabled: boolean;
	jobs: readonly CoreCanvasGenerationJob[];
	onCancel(job: CoreCanvasGenerationJob): void;
	onSnapshotChange(
		snapshot: CanvasGenerationBatchSnapshot,
	): void | Promise<void>;
	onPrimaryJobChange?(jobId: string): void;
	onResumeTextGeneration?(job: CoreCanvasGenerationJob): void;
	onRetry(job: CoreCanvasGenerationJob): void;
	snapshot: CanvasGenerationBatchSnapshot;
	textStreams: readonly CanvasTextStreamProgress[];
}) {
	const [expanded, setExpanded] = useState(false);
	const hydratedSnapshot = useMemo(
		() => reconcileCanvasGenerationBatchJobs(snapshot, jobs),
		[jobs, snapshot],
	);
	const summary = canvasGenerationBatchSnapshotSummary(hydratedSnapshot);
	const visibleItems = expanded
		? hydratedSnapshot.items
		: hydratedSnapshot.items.slice(0, 1);

	async function setPrimary(job: CoreCanvasGenerationJob) {
		await onSnapshotChange(
			selectCanvasGenerationBatchPrimary(snapshot, job.jobId),
		);
		onPrimaryJobChange?.(job.jobId);
	}

	return (
		<section
			aria-label="批量生成结果"
			className="canvas-generation-batch-stack"
		>
			<header>
				<strong>批量生成</strong>
				<span>
					已提交 {summary.submitted}/{summary.total}
					{summary.failed > 0 ? ` · ${summary.failed} 项未提交` : ""}
				</span>
				{hydratedSnapshot.items.length > 1 ? (
					<button onClick={() => setExpanded((value) => !value)} type="button">
						{expanded ? "收起" : "展开全部"}
					</button>
				) : null}
			</header>
			{visibleItems.map((item, index) => {
				if (item.state !== "submitted" || !item.job) {
					return (
						<article key={item.itemKey}>
							<strong>第 {index + 1} 项未提交</strong>
							<p>{canvasGenerationFailureMessage(item.error?.code)}</p>
						</article>
					);
				}
				return (
					<CanvasGenerationJobCard
						disabled={disabled}
						isPrimary={hydratedSnapshot.primaryJobId === item.job.jobId}
						job={item.job}
						key={item.itemKey}
						onCancel={onCancel}
						onPrimary={() => setPrimary(item.job as CoreCanvasGenerationJob)}
						onResumeTextGeneration={
							item.input.operation === "text.respond"
								? onResumeTextGeneration
								: undefined
						}
						onRetry={onRetry}
						ordinal={index + 1}
						textStream={textStreams.find(
							(stream) => stream.jobId === item.job?.jobId,
						)}
					/>
				);
			})}
		</section>
	);
}

function CanvasGenerationQuoteSummary({
	quotes,
}: {
	quotes: CanvasGenerationFanOutQuoteProjection;
}) {
	return (
		<section aria-label="报价汇总" className="canvas-generation-quote-summary">
			<strong>报价汇总</strong>
			{quotes.totalEstimatedProviderCost ? (
				<p>
					{formatEstimatedCost(
						quotes.totalEstimatedProviderCost.amountMicros,
						quotes.totalEstimatedProviderCost.currency,
					)}
					· {quotes.items.length} 项
				</p>
			) : (
				<p>存在未成功报价的项目，不能确认提交。</p>
			)}
			<ul>
				{quotes.items.map((item, index) => (
					<li key={item.itemKey}>
						第 {index + 1} 项：
						{item.state === "quoted"
							? "已报价"
							: canvasGenerationFailureMessage(item.error?.code)}
					</li>
				))}
			</ul>
		</section>
	);
}

function CanvasGenerationJobCard({
	disabled,
	isPrimary,
	job,
	onCancel,
	onPrimary,
	onResumeTextGeneration,
	onRetry,
	ordinal,
	textStream,
}: {
	disabled: boolean;
	isPrimary: boolean;
	job: CoreCanvasGenerationJob;
	onCancel(job: CoreCanvasGenerationJob): void;
	onPrimary(): void | Promise<void>;
	onResumeTextGeneration?(job: CoreCanvasGenerationJob): void;
	onRetry(job: CoreCanvasGenerationJob): void;
	ordinal: number;
	textStream?: CanvasTextStreamProgress;
}) {
	const view = canvasGenerationJobView(job);
	return (
		<article className="canvas-generation-job-card">
			<header>
				<strong>{isPrimary ? "主图" : `第 ${ordinal} 项`}</strong>
				<span>{view.statusLabel}</span>
			</header>
			<div
				aria-label={`${view.statusLabel}进度`}
				aria-valuemax={100}
				aria-valuemin={0}
				aria-valuenow={view.progress}
				role="progressbar"
			>
				<div style={{ width: `${view.progress}%` }} />
			</div>
			<p>
				{view.detail}
				{view.billingLabel ? ` · ${view.billingLabel}` : ""}
			</p>
			{textStream?.state === "disconnected" ? (
				<p>文本预览已断开，可从上次进度恢复。</p>
			) : null}
			<div>
				<button
					disabled={disabled}
					onClick={() => void onPrimary()}
					type="button"
				>
					设为主图
				</button>
				{view.retryable ? (
					<button
						disabled={disabled}
						onClick={() => onRetry(job)}
						type="button"
					>
						重新生成
					</button>
				) : null}
				{view.cancellable ? (
					<button
						disabled={disabled}
						onClick={() => onCancel(job)}
						type="button"
					>
						请求取消
					</button>
				) : null}
				{onResumeTextGeneration && textStream?.state === "disconnected" ? (
					<button
						disabled={disabled}
						onClick={() => onResumeTextGeneration(job)}
						type="button"
					>
						恢复文本流
					</button>
				) : null}
			</div>
		</article>
	);
}

function CanvasGenerationParameterField({
	control,
	onChange,
	value,
}: {
	control: ReturnType<typeof visibleCanvasGenerationParameterControls>[number];
	onChange(name: string, value: CanvasGenerationParameterValue): void;
	value: CanvasGenerationParameterValue | undefined;
}) {
	if (control.kind === "boolean") {
		return (
			<label>
				<input
					checked={value === true}
					onChange={(event) => onChange(control.name, event.target.checked)}
					type="checkbox"
				/>
				<span>{control.label}</span>
			</label>
		);
	}
	if (control.kind === "select") {
		return (
			<label>
				<span>{control.label}</span>
				<select
					onChange={(event) => onChange(control.name, event.target.value)}
					value={typeof value === "string" ? value : ""}
				>
					{control.options?.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>
		);
	}
	if (control.kind === "ratio") {
		return (
			<label>
				<span>{control.label}（可自定义，如 3:2）</span>
				<input
					list="canvas-generation-ratios"
					onChange={(event) => onChange(control.name, event.target.value)}
					value={typeof value === "string" ? value : ""}
				/>
				<datalist id="canvas-generation-ratios">
					<option value="1:1" />
					<option value="3:4" />
					<option value="4:3" />
					<option value="9:16" />
					<option value="16:9" />
				</datalist>
			</label>
		);
	}
	return (
		<label>
			<span>{control.label}</span>
			<input
				max={control.maximum}
				min={control.minimum}
				onChange={(event) =>
					onChange(
						control.name,
						control.kind === "number"
							? Number(event.target.value)
							: event.target.value,
					)
				}
				step={control.step}
				type={control.kind === "number" ? "number" : "text"}
				value={
					typeof value === "number" || typeof value === "string" ? value : ""
				}
			/>
		</label>
	);
}

function createCanvasBatchKey() {
	return `canvas-ui-${randomSuffix()}`;
}

function createCanvasIntentKey(action: string) {
	return `canvas-generation:${action}:${randomSuffix()}`;
}

function randomSuffix() {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2, 14);
}

function formatEstimatedCost(amountMicros: number, currency: "CNY" | "USD") {
	return new Intl.NumberFormat("zh-CN", {
		currency,
		style: "currency",
	}).format(amountMicros / 1_000_000);
}

# Issue #166 Canvas node-generation integration

`CanvasNodeGenerationWorkbench` is mounted by `CanvasShell` for the currently
selected image, text, video, audio, or Config node. The shell loads the
server-owned `getCatalog` response, creates a real revision checkpoint before
quoting, and passes only the existing `quoteGeneration`, `submitGeneration`,
`retryGeneration`, and `cancelGeneration` actions to the workbench.

## Current host behavior

1. The selected node provides the generation context and its connected Canvas
   nodes provide governed mention candidates. The workbench uses #167's
   `ResourceMentionComposer` directly, including its contentEditable `@`
   mentions, chips, and keyboard navigation; it does not maintain a second
   composer implementation.
2. Catalog filtering exposes only active models that support the chosen
   operation. The selected `modelId`, normalized ratio, allowed quality, and
   applicable video/audio parameters remain in each frozen quote snapshot and
   corresponding submit request.
3. Fan-out batches persist their frozen per-item quote, confirmation, job,
   retry/cancel, and primary-selection state on the context node. Hydration
   reads the existing `getGenerationJob` records once and reconciles that
   durable snapshot without a local job or polling loop.
4. The persisted state uses `generationProviderSnapshot`, so the existing #168
   sensitive-key export policy removes that snapshot, including its internal
   model, job, node, asset, provider, and deployment references, from exported
   project artifacts. The merchant UI renders only safe labels and job
   presentation fields.

## Text generation durability

`CanvasShell` connects `text.respond` jobs with `streamCanvasTextGeneration`.
Each stream records its sequence and cursor for recovery, while SSE deltas
only update the in-memory Kernel graph and use the shell's existing 1200 ms
autosave coalescing. Terminal, recoverable, disconnect, batch-confirmation,
and checkpoint transitions use explicit persistence; a terminal completion
then reads `getGenerationJob`, writes its durable text into the Canvas text
node, and clears the transient preview and stream record. Closing the browser
subscription does not abort the server-side producer.

## Validation boundary

Contract and integration coverage exercises model availability, strict quality
and K1 video/audio/ratio snapshots, fan-out quote/submit/retry/cancel state,
#167 mention composition, text-stream cursor/durable-result handling, Kernel
mounting, and #168 export redaction. The candidate is validated with the full
Canvas unit/contract suite plus normal and production TypeScript checks and
`git diff --check`; this evidence is not browser, live-provider, or database
acceptance evidence.

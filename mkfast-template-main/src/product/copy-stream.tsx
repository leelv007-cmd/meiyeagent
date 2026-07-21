import { experimental_useObject as useObject } from '@ai-sdk/react';
import {
  generatedCopyCandidatesSchema,
  type CopyStreamRequest,
  type GeneratedCopyCandidates,
} from '@meiye/contracts';

import { StreamingAiMarkdown } from '@/components/markdown/ai-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  copy_stream_body_empty,
  copy_stream_body_streaming,
  copy_stream_candidate,
  copy_stream_hook_empty,
  copy_stream_hook_streaming,
  copy_stream_title_pending,
  copy_stream_title_streaming,
} from '@/locale/paraglide/messages';

export type PartialCopyCandidate = {
  body?: string;
  conversionHook?: string;
  title?: string;
};

/** First non-empty title/body/hook counts as the first usable draft token. */
export function candidateHasToken(candidate?: PartialCopyCandidate | null) {
  if (!candidate) return false;
  return Boolean(
    candidate.title?.trim() ||
      candidate.body?.trim() ||
      candidate.conversionHook?.trim()
  );
}

export function copyCandidateSlots(value?: {
  candidates?: PartialCopyCandidate[];
}): [PartialCopyCandidate, PartialCopyCandidate, PartialCopyCandidate] {
  return [0, 1, 2].map((index) => value?.candidates?.[index] ?? {}) as [
    PartialCopyCandidate,
    PartialCopyCandidate,
    PartialCopyCandidate,
  ];
}

export function shouldShowCopyStreamPanel(input: {
  completed: boolean;
  hasError: boolean;
  hasObject: boolean;
  interrupted: boolean;
  loading: boolean;
}) {
  return (
    !input.completed &&
    (input.loading || input.hasObject || input.hasError || input.interrupted)
  );
}

export function useCopyCandidateStream({
  id,
  onError,
  onFinish,
}: {
  id: string;
  onError?: (error: Error) => void;
  onFinish?: (result: GeneratedCopyCandidates | undefined) => void;
}) {
  return useObject({
    api: '/api/core/p1/copy/stream',
    id,
    schema: generatedCopyCandidatesSchema,
    onError,
    onFinish: ({ object }) => onFinish?.(object),
  });
}

export function submitCopyCandidateStream(
  submit: (input: CopyStreamRequest) => void,
  input: CopyStreamRequest
) {
  submit(input);
}

/**
 * Build a CopyStreamRequest from a running CreativeJob.
 * Only copy.generate jobs participate in ADR-0007 token stream.
 */
export function buildCopyStreamRequestFromJob(job: {
  workId: string;
  submissionKey: string;
  contract: CopyStreamRequest['contract'];
}): CopyStreamRequest | null {
  if (job.contract.operation !== 'copy.generate') return null;
  if (!job.contract.catalogModelId?.trim()) return null;
  if (!job.submissionKey?.trim()) return null;
  return {
    catalogModelId: job.contract.catalogModelId,
    workId: job.workId,
    submissionKey: job.submissionKey,
    contract: job.contract,
  };
}

export function CopyCandidateStream({
  candidates,
  streaming,
}: {
  candidates?: PartialCopyCandidate[];
  streaming: boolean;
}) {
  const slots = copyCandidateSlots({ candidates });
  return (
    <div className="grid gap-3 lg:grid-cols-3" aria-live="polite">
      {slots.map((candidate, index) => {
        const hasToken = candidateHasToken(candidate);
        return (
          <Card
            className="min-w-0"
            data-has-token={hasToken ? 'true' : 'false'}
            data-testid="copy-stream-slot"
            key={index}
          >
            <CardHeader className="pb-3">
              <p className="text-xs font-medium text-muted-foreground">
                {copy_stream_candidate({ number: index + 1 })}
              </p>
              <CardTitle className="min-h-6 text-base">
                {candidate.title ||
                  (streaming
                    ? copy_stream_title_streaming()
                    : copy_stream_title_pending())}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {candidate.body ? (
                <StreamingAiMarkdown
                  className="prose prose-sm max-w-none dark:prose-invert"
                  content={candidate.body}
                  streaming={streaming}
                />
              ) : (
                <p className="min-h-20 text-sm text-muted-foreground">
                  {streaming
                    ? copy_stream_body_streaming()
                    : copy_stream_body_empty()}
                </p>
              )}
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                {candidate.conversionHook ||
                  (streaming
                    ? copy_stream_hook_streaming()
                    : copy_stream_hook_empty())}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

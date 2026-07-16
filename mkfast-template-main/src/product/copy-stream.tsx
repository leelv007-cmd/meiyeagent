import { experimental_useObject as useObject } from '@ai-sdk/react';
import {
  generatedCopyCandidatesSchema,
  type CopyStreamRequest,
  type GeneratedCopyCandidates,
} from '@meiye/contracts';

import { StreamingAiMarkdown } from '@/components/markdown/ai-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { m } from '@/locale/paraglide/messages';

export type PartialCopyCandidate = {
  body?: string;
  conversionHook?: string;
  title?: string;
};

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
      {slots.map((candidate, index) => (
        <Card className="min-w-0" key={index}>
          <CardHeader className="pb-3">
            <p className="text-xs font-medium text-muted-foreground">
              {m.copy_stream_candidate({ number: index + 1 })}
            </p>
            <CardTitle className="min-h-6 text-base">
              {candidate.title ||
                (streaming
                  ? m.copy_stream_title_streaming()
                  : m.copy_stream_title_pending())}
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
                  ? m.copy_stream_body_streaming()
                  : m.copy_stream_body_empty()}
              </p>
            )}
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              {candidate.conversionHook ||
                (streaming
                  ? m.copy_stream_hook_streaming()
                  : m.copy_stream_hook_empty())}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

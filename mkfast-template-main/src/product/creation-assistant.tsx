import { useChat } from '@ai-sdk/react';
import type { AssistantStreamRequest } from '@meiye/contracts';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { StreamingAiMarkdown } from '@/components/markdown/ai-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  creation_assistant_accept,
  creation_assistant_aria,
  creation_assistant_context_aria,
  creation_assistant_context_loading,
  creation_assistant_context_ready,
  creation_assistant_context_unavailable,
  creation_assistant_conversation_aria,
  creation_assistant_decision_accepted,
  creation_assistant_decision_editing,
  creation_assistant_decision_ignored,
  creation_assistant_decision_pending,
  creation_assistant_edit,
  creation_assistant_empty,
  creation_assistant_field_audience,
  creation_assistant_field_intent,
  creation_assistant_field_scene,
  creation_assistant_field_tone,
  creation_assistant_ignore,
  creation_assistant_input_aria,
  creation_assistant_input_placeholder,
  creation_assistant_interrupted,
  creation_assistant_local_only,
  creation_assistant_patch_aria,
  creation_assistant_patch_edit_aria,
  creation_assistant_patch_loading,
  creation_assistant_patch_title,
  creation_assistant_patch_unavailable,
  creation_assistant_save_edit,
  creation_assistant_send,
  creation_assistant_source_count,
  creation_assistant_speaker_assistant,
  creation_assistant_speaker_user,
  creation_assistant_stop,
  creation_assistant_title,
} from '@/locale/paraglide/messages';

import {
  initialAssistantPatchDecision,
  isConversationNearBottom,
  projectAssistantMessageParts,
  reduceAssistantPatchDecision,
  type AssistantVisiblePart,
} from './creation-assistant-model';

type AssistantContext = AssistantStreamRequest['context'];

type CreationAssistantProps = {
  catalogModelId: string;
  context: AssistantContext;
};

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

const FIELD_LABELS = {
  audience: creation_assistant_field_audience,
  intent: creation_assistant_field_intent,
  scene: creation_assistant_field_scene,
  tone: creation_assistant_field_tone,
} as const;

export function AssistantMessageParts({
  parts,
  streaming,
}: {
  parts: readonly unknown[];
  streaming: boolean;
}) {
  const visibleParts = projectAssistantMessageParts(parts);
  return (
    <div className="space-y-3">
      {visibleParts.map((part) => {
        if (part.kind === 'text') {
          return (
            <StreamingAiMarkdown
              className="prose prose-sm max-w-none dark:prose-invert"
              content={part.text}
              key={part.id}
              streaming={streaming}
            />
          );
        }
        if (part.kind === 'context') {
          return <AssistantContextPart key={part.id} part={part} />;
        }
        return <AssistantFieldPatchPart key={part.id} part={part} />;
      })}
    </div>
  );
}

function AssistantContextPart({
  part,
}: {
  part: Extract<AssistantVisiblePart, { kind: 'context' }>;
}) {
  if (part.state === 'loading') {
    return (
      <p className="rounded-md border bg-background/70 p-3 text-sm text-muted-foreground">
        {creation_assistant_context_loading()}
      </p>
    );
  }
  if (part.state === 'unavailable' || !part.summary) {
    return (
      <p className="rounded-md border bg-background/70 p-3 text-sm text-muted-foreground">
        {creation_assistant_context_unavailable()}
      </p>
    );
  }
  return (
    <section
      aria-label={creation_assistant_context_aria()}
      className="space-y-2 rounded-md border bg-background/70 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{creation_assistant_context_ready()}</p>
        <Badge variant="outline">
          {creation_assistant_source_count({
            count: part.summary.sourceCount,
          })}
        </Badge>
      </div>
      <p>{part.summary.intent}</p>
      {[
        [creation_assistant_field_scene(), part.summary.scene],
        [creation_assistant_field_tone(), part.summary.tone],
        [creation_assistant_field_audience(), part.summary.audience],
      ].map(([label, value]) =>
        value ? (
          <p className="text-xs text-muted-foreground" key={label}>
            {label}：{value}
          </p>
        ) : null
      )}
    </section>
  );
}

function AssistantFieldPatchPart({
  part,
}: {
  part: Extract<AssistantVisiblePart, { kind: 'field-patch' }>;
}) {
  if (part.state === 'loading') {
    return (
      <p className="rounded-md border bg-background/70 p-3 text-sm text-muted-foreground">
        {creation_assistant_patch_loading()}
      </p>
    );
  }
  if (part.state === 'unavailable' || !part.patch) {
    return (
      <p className="rounded-md border bg-background/70 p-3 text-sm text-muted-foreground">
        {creation_assistant_patch_unavailable()}
      </p>
    );
  }
  return <EditableAssistantFieldPatch patch={part.patch} />;
}

function EditableAssistantFieldPatch({
  patch,
}: {
  patch: NonNullable<
    Extract<AssistantVisiblePart, { kind: 'field-patch' }>['patch']
  >;
}) {
  const [decision, dispatch] = useReducer(
    reduceAssistantPatchDecision,
    patch.value,
    initialAssistantPatchDecision
  );
  const fieldLabel = FIELD_LABELS[patch.field]();

  useEffect(() => {
    dispatch({ type: 'reset', value: patch.value });
  }, [patch.field, patch.reason, patch.value]);

  return (
    <section
      aria-label={creation_assistant_patch_aria({ field: fieldLabel })}
      className="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">
          {creation_assistant_patch_title({ field: fieldLabel })}
        </p>
        <Badge variant="outline">{creation_assistant_local_only()}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{patch.reason}</p>
      {decision.state === 'editing' ? (
        <Textarea
          aria-label={creation_assistant_patch_edit_aria({
            field: fieldLabel,
          })}
          onChange={(event) =>
            dispatch({ type: 'change', value: event.currentTarget.value })
          }
          value={decision.value}
        />
      ) : (
        <p className="whitespace-pre-wrap rounded-md bg-background px-3 py-2 text-sm">
          {decision.value}
        </p>
      )}
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {decision.state === 'accepted'
          ? creation_assistant_decision_accepted()
          : decision.state === 'editing'
            ? creation_assistant_decision_editing()
            : decision.state === 'ignored'
              ? creation_assistant_decision_ignored()
              : creation_assistant_decision_pending()}
      </p>
      {decision.state === 'pending' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => dispatch({ type: 'accept' })}
            size="sm"
            type="button"
          >
            {creation_assistant_accept()}
          </Button>
          <Button
            onClick={() => dispatch({ type: 'edit' })}
            size="sm"
            type="button"
            variant="outline"
          >
            {creation_assistant_edit()}
          </Button>
          <Button
            onClick={() => dispatch({ type: 'ignore' })}
            size="sm"
            type="button"
            variant="ghost"
          >
            {creation_assistant_ignore()}
          </Button>
        </div>
      ) : decision.state === 'editing' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!decision.value.trim()}
            onClick={() => dispatch({ type: 'save-edit' })}
            size="sm"
            type="button"
          >
            {creation_assistant_save_edit()}
          </Button>
          <Button
            onClick={() => dispatch({ type: 'ignore' })}
            size="sm"
            type="button"
            variant="ghost"
          >
            {creation_assistant_ignore()}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function AssistantConversationEntry({
  message,
  streaming,
}: {
  message: UIMessage;
  streaming: boolean;
}) {
  const content = messageText(message);
  const visibleParts = projectAssistantMessageParts(message.parts);
  if (!content && visibleParts.length === 0) return null;
  const isUser = message.role === 'user';

  return (
    <div
      className={
        isUser
          ? 'ml-auto max-w-[88%] rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground'
          : 'rounded-xl border bg-muted/35 px-4 py-3'
      }
    >
      <span className="sr-only">
        {isUser
          ? creation_assistant_speaker_user()
          : creation_assistant_speaker_assistant()}
      </span>
      {message.role === 'assistant' ? (
        <AssistantMessageParts parts={message.parts} streaming={streaming} />
      ) : (
        <p className="whitespace-pre-wrap">{content}</p>
      )}
    </div>
  );
}

export function CreationAssistant({
  catalogModelId,
  context,
}: CreationAssistantProps) {
  const [input, setInput] = useState('');
  const conversationRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/core/p1/assistant/stream',
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            catalogModelId,
            context,
            messages: messages
              .filter(
                (message) =>
                  message.role === 'user' || message.role === 'assistant'
              )
              .map((message) => ({
                role: message.role as 'user' | 'assistant',
                content: messageText(message),
              }))
              .filter((message) => message.content.trim().length > 0),
          } satisfies AssistantStreamRequest,
        }),
      }),
    [catalogModelId, context]
  );
  const { error, messages, sendMessage, status, stop } = useChat({
    id: `creation-assistant-${context.workId}`,
    transport,
    throttle: 50,
  });
  const streaming = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || !stickToBottomRef.current) return;
    conversation.scrollTop = conversation.scrollHeight;
  }, [messages]);

  const submit = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    stickToBottomRef.current = true;
    setInput('');
    await sendMessage({ text });
  };

  return (
    <Card aria-label={creation_assistant_aria()} className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {creation_assistant_title()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {messages.length > 0 ? (
          <div
            aria-label={creation_assistant_conversation_aria()}
            aria-live="polite"
            aria-relevant="additions text"
            className="max-h-96 space-y-3 overflow-y-auto pr-1"
            onScroll={(event) => {
              stickToBottomRef.current = isConversationNearBottom(
                event.currentTarget
              );
            }}
            ref={conversationRef}
            role="log"
          >
            {messages.map((message, index) => {
              const isCurrentAssistant =
                message.role === 'assistant' && index === messages.length - 1;
              return (
                <AssistantConversationEntry
                  key={message.id}
                  message={message}
                  streaming={streaming && isCurrentAssistant}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {creation_assistant_empty()}
          </p>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {creation_assistant_interrupted()}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Textarea
            aria-label={creation_assistant_input_aria()}
            className="min-h-24 flex-1"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={creation_assistant_input_placeholder()}
            value={input}
          />
          {streaming ? (
            <Button onClick={() => void stop()} type="button" variant="outline">
              {creation_assistant_stop()}
            </Button>
          ) : (
            <Button
              disabled={!input.trim()}
              onClick={() => void submit()}
              type="button"
            >
              {creation_assistant_send()}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

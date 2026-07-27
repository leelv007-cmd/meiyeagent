/**
 * Persistent free-text adjust entry — "还想怎么改？" (D-046 / D-085 / #100).
 */

import { Button } from '@/components/ui/button';
import { useState } from 'react';

import {
  ADJUST_PROMPT_PLACEHOLDER,
  ADJUST_PROMPT_SUBMIT_LABEL,
} from './copy-image-text-worksurface-model';

export type AdjustPromptProps = {
  placeholder?: string;
  submitLabel?: string;
  disabled?: boolean;
  /**
   * Why this box cannot be used, in merchant words. A result the page cannot
   * adjust used to render an enabled box whose submit handler returned without
   * saying anything; saying it is the fix.
   */
  unavailableReason?: string;
  onSubmit?: (instruction: string) => void;
  /** Optional scope chips (image: 调整这张 / 调整整组). */
  scopeActions?: { id: string; label: string }[];
  selectedScopeId?: string;
  onScopeAction?: (id: string) => void;
};

export function AdjustPrompt(props: AdjustPromptProps) {
  const [text, setText] = useState('');
  const placeholder = props.placeholder ?? ADJUST_PROMPT_PLACEHOLDER;
  const submitLabel = props.submitLabel ?? ADJUST_PROMPT_SUBMIT_LABEL;

  return (
    <section
      className="space-y-2 rounded-lg border p-3"
      data-testid="result-adjust-prompt"
    >
      <label className="text-sm font-medium" htmlFor="result-adjust-input">
        {placeholder}
      </label>
      {props.unavailableReason ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="result-adjust-unavailable"
        >
          {props.unavailableReason}
        </p>
      ) : null}
      {props.scopeActions && props.scopeActions.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="result-adjust-scope">
          {props.scopeActions.map((action) => (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant="outline"
              data-testid={`result-adjust-scope-${action.id}`}
              data-active={
                props.selectedScopeId === action.id ? 'true' : 'false'
              }
              onClick={() => props.onScopeAction?.(action.id)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
      <textarea
        id="result-adjust-input"
        className="min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm"
        data-testid="result-adjust-input"
        placeholder={placeholder}
        value={text}
        disabled={props.disabled}
        onChange={(event) => setText(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        data-testid="result-adjust-submit"
        disabled={props.disabled || text.trim().length === 0}
        onClick={() => {
          const instruction = text.trim();
          if (!instruction) return;
          props.onSubmit?.(instruction);
          setText('');
        }}
      >
        {submitLabel}
      </Button>
    </section>
  );
}

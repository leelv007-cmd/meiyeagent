/**
 * Narrative document line — Workstream, not a chat bubble (V3.1 §28 / V31-04).
 */

import { cn } from '@/lib/utils';
import { WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS } from '@/product/composer/workbench-shell';

export type NarrativeLineProps = {
  id: string;
  text: string;
  occurredAt?: string;
  streamOffset?: string;
  deliveryKey?: string;
  className?: string;
};

export function NarrativeLine(props: NarrativeLineProps) {
  return (
    <article
      className={cn(
        // Document row — no chat bubble chrome, no user-message slot
        WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS,
        'meiye-workstream-narrative relative z-40 text-foreground border-border/60 border-l-2 py-2 pl-3 text-sm leading-relaxed',
        props.className
      )}
      data-agent-frame="narrative"
      data-surface="narrative"
      data-testid="agent-narrative-line"
      data-turn-kind="narrative"
      id={props.id}
    >
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {props.text}
      </p>
    </article>
  );
}

/** Process-local live fan-out for semantic SSE consumers. Durable replay stays in PG. */

import type { AgentSemanticFrame } from './agent-semantic-frames.js';
import type {
  AgentSemanticLiveSink,
  AgentSemanticLiveSource,
} from './semantic-event-projector.js';

type Subscriber = {
  threadId: string;
  queue: AgentSemanticFrame[];
  waiting: Array<(result: IteratorResult<AgentSemanticFrame>) => void>;
  closed: boolean;
};

export class AgentSemanticLiveHub
  implements AgentSemanticLiveSink, AgentSemanticLiveSource
{
  private readonly subscribers = new Set<Subscriber>();

  publish(frame: AgentSemanticFrame): void {
    const threadId = frame.data.threadId;
    for (const subscriber of this.subscribers) {
      if (subscriber.closed || subscriber.threadId !== threadId) continue;
      const waiter = subscriber.waiting.shift();
      if (waiter) waiter({ done: false, value: frame });
      else subscriber.queue.push(frame);
    }
  }

  subscribe(input: {
    threadId: string;
    signal?: AbortSignal;
  }): AsyncIterable<AgentSemanticFrame> {
    const subscriber: Subscriber = {
      threadId: input.threadId,
      queue: [],
      waiting: [],
      closed: false,
    };
    this.subscribers.add(subscriber);

    const close = () => {
      if (subscriber.closed) return;
      subscriber.closed = true;
      this.subscribers.delete(subscriber);
      for (const waiter of subscriber.waiting.splice(0)) {
        waiter({ done: true, value: undefined });
      }
      subscriber.queue.length = 0;
      input.signal?.removeEventListener('abort', close);
    };
    if (input.signal?.aborted) close();
    else input.signal?.addEventListener('abort', close, { once: true });

    const iterator: AsyncIterator<AgentSemanticFrame> = {
      next: () => {
        const frame = subscriber.queue.shift();
        if (frame) return Promise.resolve({ done: false, value: frame });
        if (subscriber.closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve) => subscriber.waiting.push(resolve));
      },
      return: () => {
        close();
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  }

  /** Test/health probe only; no subscriber identities are exposed. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

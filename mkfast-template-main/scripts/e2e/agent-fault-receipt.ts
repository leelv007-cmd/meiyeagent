type FaultRequestDiagnostic = {
  failure: 'request_failed' | null;
  faultInjected: boolean;
  matchesTargetThread: boolean | null;
  originalUrl: string;
  receipt: string | null;
  status: number | null;
};

type AgentE2EFault = 'artifact-gap-close' | 'artifact-head-replay';

type FaultRequestRecord = Omit<
  FaultRequestDiagnostic,
  'matchesTargetThread'
> & {
  receiptMatchesFault: boolean;
  threadId: string;
};

const AGENT_EVENTS_PATH = /^\/api\/core\/p1\/agent-threads\/([^/]+)\/events$/u;

function diagnosticUrl(rawUrl: string) {
  const source = new URL(rawUrl);
  const redacted = new URL(source.pathname, source.origin);
  for (const [name] of [...source.searchParams.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    redacted.searchParams.append(name, '<redacted>');
  }
  return redacted.toString();
}

function agentThreadId(rawUrl: string) {
  const encoded = new URL(rawUrl).pathname.match(AGENT_EVENTS_PATH)?.[1];
  if (!encoded) {
    throw new Error('fault receipt probe requires an Agent events URL');
  }
  const threadId = decodeURIComponent(encoded).trim();
  if (!threadId || threadId.length > 200) {
    throw new Error('fault receipt probe requires a valid Agent Thread id');
  }
  return threadId;
}

/**
 * Tracks one browser-routed Core E2E fault without treating a cancelled request
 * as proof that Core consumed it. Diagnostics redact every query value and
 * collapse browser failures to a fixed category so CI artifacts stay safe.
 */
export class AgentFaultReceiptProbe {
  readonly #fault: AgentE2EFault;
  readonly #requests = new Map<object, FaultRequestRecord>();
  #targetThreadId: string | null = null;

  constructor(fault: AgentE2EFault) {
    this.#fault = fault;
  }

  get receiptObserved() {
    if (!this.#targetThreadId) return false;
    return [...this.#requests.values()].some(
      (request) =>
        request.threadId === this.#targetThreadId &&
        request.faultInjected &&
        request.failure === null &&
        request.status === 200 &&
        request.receiptMatchesFault
    );
  }

  bindTargetThread(threadId: string) {
    const target = threadId.trim();
    if (!target || target.length > 200) {
      throw new Error('fault receipt probe requires a valid target Thread');
    }
    if (this.#targetThreadId && this.#targetThreadId !== target) {
      throw new Error('fault receipt probe target Thread is already bound');
    }
    this.#targetThreadId = target;
  }

  beginRequest(request: object, originalUrl: string) {
    const url = new URL(originalUrl);
    if (url.searchParams.has('e2eAgentFault')) {
      throw new Error(
        'original browser request already contains e2eAgentFault'
      );
    }
    if (this.#requests.has(request)) {
      throw new Error('fault receipt probe request is already registered');
    }
    const threadId = agentThreadId(originalUrl);
    const faultInjected =
      !this.receiptObserved &&
      (!this.#targetThreadId || threadId === this.#targetThreadId);
    this.#requests.set(request, {
      failure: null,
      faultInjected,
      originalUrl: diagnosticUrl(originalUrl),
      receipt: null,
      receiptMatchesFault: false,
      status: null,
      threadId,
    });
    if (!faultInjected) return { forwardUrl: null };
    url.searchParams.set('e2eAgentFault', this.#fault);
    return { forwardUrl: url.toString() };
  }

  recordFailure(request: object, errorText: string) {
    void errorText;
    const diagnostic = this.#requests.get(request);
    if (diagnostic) diagnostic.failure = 'request_failed';
  }

  recordResponse(request: object, status: number, receipt: string | null) {
    const diagnostic = this.#requests.get(request);
    if (diagnostic) {
      diagnostic.status = status;
      diagnostic.receipt =
        receipt === null
          ? null
          : receipt === this.#fault
            ? this.#fault
            : '<unexpected>';
      diagnostic.receiptMatchesFault = receipt === this.#fault;
    }
  }

  diagnostics(): FaultRequestDiagnostic[] {
    return [...this.#requests.values()].map(
      ({
        receiptMatchesFault: _receiptMatchesFault,
        threadId,
        ...diagnostic
      }) => ({
        ...diagnostic,
        matchesTargetThread: this.#targetThreadId
          ? threadId === this.#targetThreadId
          : null,
      })
    );
  }
}

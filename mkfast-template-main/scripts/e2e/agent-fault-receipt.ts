type FaultRequestDiagnostic = {
  failure: 'request_failed' | null;
  faultInjected: boolean;
  finished: boolean;
  matchesTargetThread: boolean | null;
  originalUrl: string;
  receipt: string | null;
  recoveryForTerminalSequence: number | null;
  recoveryRequest: boolean;
  requestSequence: number;
  responseHeadersPending: boolean;
  status: number | null;
  successfulFault: boolean;
  successfulTerminalSequence: number | null;
};

type AgentE2EFault = 'artifact-gap-close' | 'artifact-head-replay';

type FaultRequestRecord = Omit<
  FaultRequestDiagnostic,
  'matchesTargetThread' | 'recoveryRequest' | 'successfulFault'
> & {
  receiptMatchesFault: boolean;
  threadId: string;
};

type AgentEndpoint = 'events' | 'replay';

const AGENT_ENDPOINT_PATH =
  /^\/api\/core\/p1\/agent-threads\/([^/]+)\/(events|replay)$/u;
const DIAGNOSTIC_QUERY_KEYS = ['lastEventId', 'lastStreamOffset'] as const;
const DIAGNOSTIC_QUERY_KEY_SET = new Set<string>(DIAGNOSTIC_QUERY_KEYS);
const FAULT_ENDPOINT = {
  'artifact-gap-close': 'events',
  'artifact-head-replay': 'replay',
} as const satisfies Record<AgentE2EFault, AgentEndpoint>;

function diagnosticUrl(rawUrl: string) {
  const source = new URL(rawUrl);
  const redacted = new URL(source.pathname, source.origin);
  const queryNames = new Set(source.searchParams.keys());
  for (const name of DIAGNOSTIC_QUERY_KEYS) {
    if (queryNames.has(name)) redacted.searchParams.set(name, '<redacted>');
  }
  if ([...queryNames].some((name) => !DIAGNOSTIC_QUERY_KEY_SET.has(name))) {
    redacted.searchParams.set('other', '<redacted>');
  }
  return redacted.toString();
}

function agentThreadId(rawUrl: string, endpoint: AgentEndpoint) {
  const match = new URL(rawUrl).pathname.match(AGENT_ENDPOINT_PATH);
  if (!match?.[1] || match[2] !== endpoint) {
    throw new Error(`fault receipt probe requires an Agent ${endpoint} URL`);
  }
  const threadId = decodeURIComponent(match[1]).trim();
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
  readonly #endpoint: AgentEndpoint;
  readonly #fault: AgentE2EFault;
  readonly #requests = new Map<object, FaultRequestRecord>();
  readonly #targetThreadWaiters = new Set<() => void>();
  #faultInjectionIssued = false;
  #inFlightInjectedRequest: object | null = null;
  #sequence = 0;
  #targetThreadId: string | null = null;

  constructor(fault: AgentE2EFault) {
    this.#fault = fault;
    this.#endpoint = FAULT_ENDPOINT[fault];
  }

  get appliedReceiptCount() {
    return [...this.#requests.values()].filter((request) =>
      this.#isSuccessfulFault(request)
    ).length;
  }

  get injectedRequestCount() {
    return [...this.#requests.values()].filter(
      (request) => request.faultInjected
    ).length;
  }

  get receiptedInjectedRequestCount() {
    return [...this.#requests.values()].filter(
      (request) => request.faultInjected && request.receiptMatchesFault
    ).length;
  }

  get receiptObserved() {
    return (
      this.injectedRequestCount === 1 &&
      this.receiptedInjectedRequestCount === 1 &&
      this.appliedReceiptCount === 1
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
    const waiters = [...this.#targetThreadWaiters];
    this.#targetThreadWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  async beginRequestAfterTarget(
    request: object,
    originalUrl: string,
    timeoutMs: number
  ) {
    await this.#waitForTargetThread(timeoutMs);
    return this.beginRequest(request, originalUrl);
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
    const threadId = agentThreadId(originalUrl, this.#endpoint);
    const requestSequence = ++this.#sequence;
    const matchesTargetThread =
      this.#targetThreadId !== null && threadId === this.#targetThreadId;
    const faultInjected =
      !this.#faultInjectionIssued &&
      this.#inFlightInjectedRequest === null &&
      matchesTargetThread;
    const successfulTerminalSequence = this.#singleSuccessfulTerminalSequence();
    const recoveryForTerminalSequence =
      !faultInjected &&
      matchesTargetThread &&
      successfulTerminalSequence !== null &&
      ![...this.#requests.values()].some(
        (candidate) =>
          candidate.recoveryForTerminalSequence === successfulTerminalSequence
      )
        ? successfulTerminalSequence
        : null;
    this.#requests.set(request, {
      failure: null,
      faultInjected,
      finished: false,
      originalUrl: diagnosticUrl(originalUrl),
      receipt: null,
      receiptMatchesFault: false,
      recoveryForTerminalSequence,
      requestSequence,
      responseHeadersPending: false,
      status: null,
      successfulTerminalSequence: null,
      threadId,
    });
    if (!faultInjected) return { forwardUrl: null };
    this.#faultInjectionIssued = true;
    this.#inFlightInjectedRequest = request;
    url.searchParams.set('e2eAgentFault', this.#fault);
    return { forwardUrl: url.toString() };
  }

  recordFailure(request: object, errorText: string) {
    void errorText;
    const diagnostic = this.#requests.get(request);
    if (diagnostic) {
      diagnostic.failure = 'request_failed';
      this.#syncSuccessfulTerminalSequence(diagnostic);
      this.#releaseIfTerminal(request, diagnostic);
    }
  }

  recordFinished(request: object) {
    const diagnostic = this.#requests.get(request);
    if (diagnostic) {
      diagnostic.finished = true;
      this.#syncSuccessfulTerminalSequence(diagnostic);
      this.#releaseIfTerminal(request, diagnostic);
    }
  }

  recordResponseStarted(request: object, status: number) {
    const diagnostic = this.#requests.get(request);
    if (diagnostic) {
      diagnostic.responseHeadersPending = true;
      diagnostic.status = status;
      this.#syncSuccessfulTerminalSequence(diagnostic);
    }
  }

  recordResponse(request: object, status: number, receipt: string | null) {
    const diagnostic = this.#requests.get(request);
    if (diagnostic) {
      diagnostic.responseHeadersPending = false;
      diagnostic.status = status;
      diagnostic.receipt =
        receipt === null
          ? null
          : receipt === this.#fault
            ? this.#fault
            : '<unexpected>';
      diagnostic.receiptMatchesFault = receipt === this.#fault;
      this.#syncSuccessfulTerminalSequence(diagnostic);
      this.#releaseIfTerminal(request, diagnostic);
    }
  }

  isRecoveryRequest(request: object) {
    const diagnostic = this.#requests.get(request);
    const successfulTerminalSequence = this.#singleSuccessfulTerminalSequence();
    return Boolean(
      diagnostic &&
        successfulTerminalSequence !== null &&
        diagnostic.recoveryForTerminalSequence === successfulTerminalSequence
    );
  }

  diagnostics(): FaultRequestDiagnostic[] {
    return [...this.#requests.entries()].map(([requestKey, request]) => {
      const {
        receiptMatchesFault: _receiptMatchesFault,
        threadId,
        ...diagnostic
      } = request;
      return {
        ...diagnostic,
        matchesTargetThread: this.#targetThreadId
          ? threadId === this.#targetThreadId
          : null,
        recoveryRequest: this.isRecoveryRequest(requestKey),
        successfulFault: this.#isSuccessfulFault(request),
      };
    });
  }

  #isSuccessfulFault(request: FaultRequestRecord) {
    return Boolean(
      request.faultInjected &&
        request.failure === null &&
        request.finished &&
        !request.responseHeadersPending &&
        request.status === 200 &&
        request.receiptMatchesFault
    );
  }

  #singleSuccessfulTerminalSequence() {
    const successful = [...this.#requests.values()].filter((request) =>
      this.#isSuccessfulFault(request)
    );
    return successful.length === 1
      ? (successful[0]?.successfulTerminalSequence ?? null)
      : null;
  }

  #syncSuccessfulTerminalSequence(request: FaultRequestRecord) {
    if (!this.#isSuccessfulFault(request)) {
      request.successfulTerminalSequence = null;
      return;
    }
    request.successfulTerminalSequence ??= ++this.#sequence;
  }

  async #waitForTargetThread(timeoutMs: number) {
    if (this.#targetThreadId) return;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('fault receipt probe target wait requires a timeout');
    }
    await new Promise<void>((resolve, reject) => {
      const onTargetBound = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.#targetThreadWaiters.delete(onTargetBound);
        reject(
          new Error(
            'fault receipt probe target Thread was not bound before the deadline'
          )
        );
      }, timeoutMs);
      this.#targetThreadWaiters.add(onTargetBound);
    });
  }

  #releaseIfTerminal(request: object, diagnostic: FaultRequestRecord) {
    if (this.#inFlightInjectedRequest !== request) return;
    if (
      diagnostic.failure === 'request_failed' ||
      (diagnostic.finished && !diagnostic.responseHeadersPending)
    ) {
      this.#inFlightInjectedRequest = null;
    }
  }
}

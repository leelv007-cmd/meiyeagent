type FaultRequestDiagnostic = {
  failure: string | null;
  faultInjected: boolean;
  originalUrl: string;
  receipt: string | null;
  status: number | null;
};

const SAFE_QUERY_PARAMETERS = new Set([
  'e2eAgentFault',
  'lastEventId',
  'lastStreamOffset',
]);

function diagnosticUrl(rawUrl: string) {
  const source = new URL(rawUrl);
  const redacted = new URL(source.pathname, source.origin);
  for (const [name, value] of [...source.searchParams.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    redacted.searchParams.append(
      name,
      SAFE_QUERY_PARAMETERS.has(name) ? value : '<redacted>'
    );
  }
  return redacted.toString();
}

function diagnosticFailure(errorText: string) {
  const normalized = errorText.trim();
  return /^net::[A-Z0-9_:-]+$/u.test(normalized)
    ? normalized
    : '<redacted browser failure>';
}

/**
 * Tracks one browser-routed Core E2E fault without treating a cancelled request
 * as proof that Core consumed it. Diagnostics retain only allowlisted query
 * values so CI artifacts cannot disclose credentials.
 */
export class AgentFaultReceiptProbe {
  readonly #fault: string;
  readonly #requests = new Map<object, FaultRequestDiagnostic>();
  #receiptObserved = false;

  constructor(fault: string) {
    this.#fault = fault;
  }

  get receiptObserved() {
    return this.#receiptObserved;
  }

  beginRequest(request: object, originalUrl: string) {
    const url = new URL(originalUrl);
    if (url.searchParams.has('e2eAgentFault')) {
      throw new Error(
        'original browser request already contains e2eAgentFault'
      );
    }
    const faultInjected = !this.#receiptObserved;
    this.#requests.set(request, {
      failure: null,
      faultInjected,
      originalUrl: diagnosticUrl(originalUrl),
      receipt: null,
      status: null,
    });
    if (!faultInjected) return { forwardUrl: null };
    url.searchParams.set('e2eAgentFault', this.#fault);
    return { forwardUrl: url.toString() };
  }

  recordFailure(request: object, errorText: string) {
    const diagnostic = this.#requests.get(request);
    if (diagnostic) diagnostic.failure = diagnosticFailure(errorText);
  }

  recordResponse(request: object, status: number, receipt: string | null) {
    const diagnostic = this.#requests.get(request);
    if (diagnostic) {
      diagnostic.status = status;
      diagnostic.receipt = receipt;
    }
    if (receipt === this.#fault) this.#receiptObserved = true;
  }

  diagnostics(): FaultRequestDiagnostic[] {
    return [...this.#requests.values()].map((diagnostic) => ({
      ...diagnostic,
    }));
  }
}

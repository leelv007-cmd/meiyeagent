import type {
  DouyinAdapterPort,
  DouyinObserveAdapterPort,
  DouyinPublishAdapterPort,
} from './contracts.js';

type PublishResult = Awaited<ReturnType<DouyinPublishAdapterPort['submit']>>;

type ObserveResult = Awaited<ReturnType<DouyinObserveAdapterPort['observe']>>;

export class RecordedDouyinAdapter implements DouyinAdapterPort {
  readonly executionMode = 'recorded' as const;
  private readonly attempts: Array<{
    connectionId: string;
    accountSubject: string;
    contentSnapshotId: string;
    contentSnapshotRevision: string;
    scheduledAt: string;
    idempotencyKey: string;
    anchor?: Parameters<DouyinPublishAdapterPort['submit']>[0]['anchor'];
  }> = [];
  private readonly publishResults = new Map<string, PublishResult>();
  private nextResult: PublishResult = {
    acceptance: 'rejected_before_accept',
    status: 'failed',
    errorCode: 'recorded_not_configured',
  };
  private nextObserveResult: ObserveResult = {
    status: 'ok',
    observedAt: '1970-01-01T00:00:00.000Z',
    items: [],
  };
  private nextRefreshResult: Awaited<
    ReturnType<DouyinAdapterPort['refreshOAuth']>
  > = {
    status: 'reauthorization_required',
    errorCode: 'recorded_not_configured',
  };
  private nextInspectResult: Awaited<
    ReturnType<DouyinAdapterPort['inspectPublish']>
  > = {
    status: 'unknown',
  };
  private readonly refreshResults = new Map<
    string,
    Awaited<ReturnType<DouyinAdapterPort['refreshOAuth']>>
  >();
  private refreshEffects = 0;
  private observeEffects = 0;

  setNextPublishResult(result: PublishResult) {
    this.nextResult = structuredClone(result);
  }

  publishAttempts() {
    return structuredClone(this.attempts);
  }

  setNextObserveResult(result: ObserveResult) {
    this.nextObserveResult = structuredClone(result);
  }

  setNextRefreshResult(
    result: Awaited<ReturnType<DouyinAdapterPort['refreshOAuth']>>
  ) {
    this.nextRefreshResult = structuredClone(result);
  }

  setNextInspectResult(
    result: Awaited<ReturnType<DouyinAdapterPort['inspectPublish']>>
  ) {
    this.nextInspectResult = structuredClone(result);
  }

  refreshEffectCount() {
    return this.refreshEffects;
  }

  observeCallCount() {
    return this.observeEffects;
  }

  async submit(request: Parameters<DouyinPublishAdapterPort['submit']>[0]) {
    const replay = this.publishResults.get(request.idempotencyKey);
    if (replay) return structuredClone(replay);
    this.attempts.push({
      connectionId: request.connectionId,
      accountSubject: request.accountSubject,
      contentSnapshotId: request.contentSnapshotId,
      contentSnapshotRevision: request.contentSnapshotRevision,
      scheduledAt: request.scheduledAt,
      idempotencyKey: request.idempotencyKey,
      ...(request.anchor ? { anchor: structuredClone(request.anchor) } : {}),
    });
    const result = structuredClone(this.nextResult);
    this.publishResults.set(request.idempotencyKey, result);
    return result;
  }

  async observe(_request: Parameters<DouyinObserveAdapterPort['observe']>[0]) {
    this.observeEffects += 1;
    return structuredClone(this.nextObserveResult);
  }

  async refreshOAuth(
    request: Parameters<DouyinAdapterPort['refreshOAuth']>[0]
  ) {
    const replay = this.refreshResults.get(request.effectIdempotencyKey);
    if (replay) return structuredClone(replay);
    this.refreshEffects += 1;
    const result = structuredClone(this.nextRefreshResult);
    this.refreshResults.set(request.effectIdempotencyKey, result);
    return result;
  }

  async inspectPublish(
    _request: Parameters<DouyinAdapterPort['inspectPublish']>[0]
  ) {
    return structuredClone(this.nextInspectResult);
  }
}

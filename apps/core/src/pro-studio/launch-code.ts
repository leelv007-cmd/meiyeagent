import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

export type LaunchCodeAudience =
  | { kind: 'workspace' }
  | { kind: 'project'; projectId: string };

export interface LaunchCodeContext {
  audience: LaunchCodeAudience;
  bootstrap?: {
    locale: string;
    returnTo: string;
    theme: 'dark' | 'light' | 'system';
  };
  mainSessionId: string;
  userId: string;
  workspaceId: string;
}

export interface StoredLaunchCode extends LaunchCodeContext {
  browserNonceHash: string;
  codeHash: string;
  consumedAt?: string;
  expiresAt: string;
  issuedAt: string;
}

export interface StoredCanvasSession extends LaunchCodeContext {
  absoluteExpiresAt: string;
  createdAt: string;
  idleExpiresAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  sessionTokenHash: string;
}

export interface LaunchCodeRepository {
  insertLaunchCode(record: StoredLaunchCode): Promise<void>;
  consumeAndCreateSession(input: {
    browserNonceHash: string;
    codeHash: string;
    now: string;
    session: Omit<StoredCanvasSession, keyof LaunchCodeContext>;
  }): Promise<StoredCanvasSession | null>;
  getAndTouchSession(input: {
    idleExpiresAt: string;
    now: string;
    sessionTokenHash: string;
  }): Promise<StoredCanvasSession | null>;
  revokeSession(sessionTokenHash: string, revokedAt: string): Promise<void>;
}

export interface LaunchAccessPolicy {
  canAccessWorkspace(input: {
    mainSessionId: string;
    userId: string;
    workspaceId: string;
  }): Promise<boolean>;
  canAccessProject(input: {
    mainSessionId: string;
    projectId: string;
    userId: string;
    workspaceId: string;
  }): Promise<boolean>;
}

export type LaunchCodeErrorCode =
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'INVALID_LAUNCH_CODE'
  | 'NOT_FOUND'
  | 'SESSION_EXPIRED';

export class LaunchCodeError extends Error {
  constructor(
    readonly code: LaunchCodeErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'LaunchCodeError';
  }
}

interface LaunchCodeServiceOptions {
  access: LaunchAccessPolicy;
  clock?: () => Date;
  launchCodeTtlMs?: number;
  repository: LaunchCodeRepository;
  randomBytes?: (size: number) => Uint8Array;
  sessionAbsoluteTtlMs?: number;
  sessionIdleTtlMs?: number;
}

export class LaunchCodeService {
  private readonly clock: () => Date;
  private readonly launchCodeTtlMs: number;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly sessionAbsoluteTtlMs: number;
  private readonly sessionIdleTtlMs: number;

  constructor(private readonly options: LaunchCodeServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.launchCodeTtlMs = options.launchCodeTtlMs ?? 45_000;
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.sessionAbsoluteTtlMs = options.sessionAbsoluteTtlMs ?? 8 * 60 * 60_000;
    this.sessionIdleTtlMs = options.sessionIdleTtlMs ?? 15 * 60_000;
    if (this.launchCodeTtlMs < 30_000 || this.launchCodeTtlMs > 60_000) {
      throw new LaunchCodeError(
        'INVALID_INPUT',
        'Launch code TTL must be between 30 and 60 seconds.'
      );
    }
  }

  async issue(input: LaunchCodeContext & { browserNonce: string }) {
    requireNonEmpty(input.browserNonce, 'browserNonce');
    requireNonEmpty(input.mainSessionId, 'mainSessionId');
    requireNonEmpty(input.userId, 'userId');
    requireNonEmpty(input.workspaceId, 'workspaceId');
    if (
      !(await this.options.access.canAccessWorkspace({
        mainSessionId: input.mainSessionId,
        userId: input.userId,
        workspaceId: input.workspaceId,
      }))
    ) {
      throw new LaunchCodeError('FORBIDDEN', 'Workspace access is required.');
    }
    if (
      input.audience.kind === 'project' &&
      !(await this.options.access.canAccessProject({
        mainSessionId: input.mainSessionId,
        projectId: input.audience.projectId,
        userId: input.userId,
        workspaceId: input.workspaceId,
      }))
    ) {
      throw new LaunchCodeError('NOT_FOUND', 'Canvas project was not found.');
    }

    const code = opaqueToken(this.randomBytes(32));
    const issuedAt = this.clock();
    const expiresAt = new Date(
      issuedAt.getTime() + this.launchCodeTtlMs
    ).toISOString();
    await this.options.repository.insertLaunchCode({
      audience: structuredClone(input.audience),
      ...(input.bootstrap
        ? { bootstrap: structuredClone(input.bootstrap) }
        : {}),
      browserNonceHash: hash(input.browserNonce),
      codeHash: hash(code),
      expiresAt,
      issuedAt: issuedAt.toISOString(),
      mainSessionId: input.mainSessionId,
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
    return { code, expiresAt };
  }

  async exchange(input: { browserNonce: string; code: string }) {
    requireNonEmpty(input.browserNonce, 'browserNonce');
    requireNonEmpty(input.code, 'code');
    const sessionToken = opaqueToken(this.randomBytes(32));
    const now = this.clock();
    const nowIso = now.toISOString();
    const session = await this.options.repository.consumeAndCreateSession({
      browserNonceHash: hash(input.browserNonce),
      codeHash: hash(input.code),
      now: nowIso,
      session: {
        absoluteExpiresAt: new Date(
          now.getTime() + this.sessionAbsoluteTtlMs
        ).toISOString(),
        createdAt: nowIso,
        idleExpiresAt: new Date(
          now.getTime() + this.sessionIdleTtlMs
        ).toISOString(),
        lastSeenAt: nowIso,
        sessionTokenHash: hash(sessionToken),
      },
    });
    if (!session) {
      throw new LaunchCodeError(
        'INVALID_LAUNCH_CODE',
        'Launch code is invalid, expired, consumed, or bound to another browser.'
      );
    }
    return {
      context: launchContext(session),
      sessionToken,
    };
  }
}

export interface UpstreamCanvasSessionPolicy {
  isActive(context: LaunchCodeContext): Promise<boolean>;
}

interface CanvasSessionServiceOptions {
  clock?: () => Date;
  idleTtlMs?: number;
  repository: LaunchCodeRepository;
  upstream: UpstreamCanvasSessionPolicy;
}

export class CanvasSessionService {
  private readonly clock: () => Date;
  private readonly idleTtlMs: number;

  constructor(private readonly options: CanvasSessionServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idleTtlMs = options.idleTtlMs ?? 15 * 60_000;
  }

  async authenticate(sessionToken: string) {
    requireNonEmpty(sessionToken, 'sessionToken');
    const now = this.clock();
    const tokenHash = hash(sessionToken);
    const session = await this.options.repository.getAndTouchSession({
      idleExpiresAt: new Date(now.getTime() + this.idleTtlMs).toISOString(),
      now: now.toISOString(),
      sessionTokenHash: tokenHash,
    });
    if (!session) {
      throw new LaunchCodeError('SESSION_EXPIRED', 'Canvas session expired.');
    }
    const context = launchContext(session);
    if (!(await this.options.upstream.isActive(context))) {
      await this.options.repository.revokeSession(tokenHash, now.toISOString());
      throw new LaunchCodeError(
        'SESSION_EXPIRED',
        'The upstream account or workspace session is no longer active.'
      );
    }
    return context;
  }
}

export class MemoryLaunchCodeRepository implements LaunchCodeRepository {
  private readonly launchCodes = new Map<string, StoredLaunchCode>();
  private readonly sessions = new Map<string, StoredCanvasSession>();

  async insertLaunchCode(record: StoredLaunchCode) {
    if (this.launchCodes.has(record.codeHash)) {
      throw new LaunchCodeError('INVALID_INPUT', 'Launch code hash collision.');
    }
    this.launchCodes.set(record.codeHash, structuredClone(record));
  }

  async consumeAndCreateSession(input: {
    browserNonceHash: string;
    codeHash: string;
    now: string;
    session: Omit<StoredCanvasSession, keyof LaunchCodeContext>;
  }) {
    const launchCode = this.launchCodes.get(input.codeHash);
    if (
      !launchCode ||
      launchCode.consumedAt ||
      launchCode.browserNonceHash !== input.browserNonceHash ||
      Date.parse(launchCode.expiresAt) <= Date.parse(input.now)
    ) {
      return null;
    }
    launchCode.consumedAt = input.now;
    const session: StoredCanvasSession = {
      ...launchContext(launchCode),
      ...structuredClone(input.session),
    };
    this.sessions.set(session.sessionTokenHash, session);
    return structuredClone(session);
  }

  async getAndTouchSession(input: {
    idleExpiresAt: string;
    now: string;
    sessionTokenHash: string;
  }) {
    const session = this.sessions.get(input.sessionTokenHash);
    const now = Date.parse(input.now);
    if (
      !session ||
      session.revokedAt ||
      Date.parse(session.idleExpiresAt) <= now ||
      Date.parse(session.absoluteExpiresAt) <= now
    ) {
      return null;
    }
    session.lastSeenAt = input.now;
    session.idleExpiresAt = earlierIso(
      input.idleExpiresAt,
      session.absoluteExpiresAt
    );
    return structuredClone(session);
  }

  async revokeSession(sessionTokenHash: string, revokedAt: string) {
    const session = this.sessions.get(sessionTokenHash);
    if (session) session.revokedAt = revokedAt;
  }

  inspectLaunchCodes() {
    return structuredClone([...this.launchCodes.values()]);
  }

  inspectSessions() {
    return structuredClone([...this.sessions.values()]);
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function opaqueToken(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url');
}

function launchContext(record: LaunchCodeContext): LaunchCodeContext {
  return {
    audience: structuredClone(record.audience),
    ...(record.bootstrap
      ? { bootstrap: structuredClone(record.bootstrap) }
      : {}),
    mainSessionId: record.mainSessionId,
    userId: record.userId,
    workspaceId: record.workspaceId,
  };
}

function requireNonEmpty(value: string, field: string) {
  if (!value.trim()) {
    throw new LaunchCodeError('INVALID_INPUT', `${field} is required.`);
  }
}

function earlierIso(first: string, second: string) {
  return Date.parse(first) < Date.parse(second) ? first : second;
}

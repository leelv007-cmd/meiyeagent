import type { DiagnosticRun } from '@meiye/contracts';

export interface DiagnosticIdentity {
  userId: string;
  workspaceId: string;
}

export interface DiagnosticRepository {
  create(
    run: DiagnosticRun,
    idempotencyKey: string,
    identity: DiagnosticIdentity
  ): Promise<DiagnosticRun | null>;
  get(id: string, identity: DiagnosticIdentity): Promise<DiagnosticRun | null>;
  save(run: DiagnosticRun, identity: DiagnosticIdentity): Promise<DiagnosticRun>;
}

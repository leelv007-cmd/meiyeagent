import type {
  P1Module,
  ProductCapability,
  ProductRole,
} from '@meiye/contracts';

/**
 * Unified permission authorizer for HTTP and (via Z2-WIRING) internal execute paths.
 * Pure decision port — no I/O.
 */
export type PermissionActor =
  | ProductRole
  | 'worker'
  | 'payment'
  | undefined;

export interface PermissionAuthorizeInput {
  actor: PermissionActor;
  kind: 'command' | 'query';
  module: P1Module;
  action: string;
}

export type PermissionDecision =
  | {
      allow: true;
      required: ProductCapability | null;
      reason: 'worker_bypass' | 'payment_grant' | 'capability_granted';
    }
  | {
      allow: false;
      required: ProductCapability | null;
      reason:
        | 'unregistered'
        | 'missing_actor'
        | 'capability_denied'
        | 'payment_actor_restricted';
    };

export interface PermissionAuthorizerPort {
  decide(input: PermissionAuthorizeInput): PermissionDecision;
  /**
   * Throws with a stable code when denied.
   * Implementations must default-deny unregistered module/action pairs.
   */
  authorize(input: PermissionAuthorizeInput): void;
}

export class PermissionDeniedError extends Error {
  readonly code = 'FORBIDDEN' as const;

  constructor(
    message: string,
    readonly decision: Extract<PermissionDecision, { allow: false }>
  ) {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

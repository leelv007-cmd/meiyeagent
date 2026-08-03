import {
  hasProductCapability,
  requiredP1Capability,
  type ProductRole,
} from '@meiye/contracts';
import {
  PermissionDeniedError,
  type PermissionAuthorizerPort,
  type PermissionAuthorizeInput,
  type PermissionDecision,
} from './port.js';

/**
 * Pure ProductCapability authorizer (D-057 / #120).
 * Unknown module/action → unregistered → deny.
 * Assembly into P1ApplicationService execute/query is Z2-WIRING.
 */
export function createPermissionAuthorizer(): PermissionAuthorizerPort {
  return {
    decide(input: PermissionAuthorizeInput): PermissionDecision {
      if (input.actor === 'worker') {
        return { allow: true, required: null, reason: 'worker_bypass' };
      }

      // Payment service actor may only settle verified payment grants.
      if (input.actor === 'payment') {
        if (
          input.kind === 'command' &&
          input.module === 'entitlements' &&
          (input.action === 'payment_grant' ||
            input.action === 'payment_add_on_grant')
        ) {
          return { allow: true, required: null, reason: 'payment_grant' };
        }
        return {
          allow: false,
          required: null,
          reason: 'payment_actor_restricted',
        };
      }

      const required = requiredP1Capability(
        input.kind,
        input.module,
        input.action
      );
      if (required === null) {
        return { allow: false, required: null, reason: 'unregistered' };
      }

      if (!input.actor) {
        return { allow: false, required, reason: 'missing_actor' };
      }

      if (!hasProductCapability(input.actor as ProductRole, required)) {
        return { allow: false, required, reason: 'capability_denied' };
      }

      return { allow: true, required, reason: 'capability_granted' };
    },

    authorize(input: PermissionAuthorizeInput): void {
      const decision = this.decide(input);
      if (decision.allow) return;

      if (decision.reason === 'payment_actor_restricted') {
        throw new PermissionDeniedError(
          'The payment actor can only execute entitlements payment grants.',
          decision
        );
      }
      if (decision.reason === 'unregistered') {
        throw new PermissionDeniedError(
          'This module action is not registered for authorization.',
          decision
        );
      }
      throw new PermissionDeniedError(
        'The current product role cannot perform this action.',
        decision
      );
    },
  };
}

/** Shared singleton for the HTTP authorize path (no DI required). */
export const defaultPermissionAuthorizer = createPermissionAuthorizer();

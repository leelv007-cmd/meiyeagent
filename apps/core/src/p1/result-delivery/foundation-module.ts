import {
  adoptIntoContentPackageCommandSchema,
  reviseContentPackageVisualsCommandSchema,
} from '@meiye/contracts';
import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { VisualAdoptionError } from './errors.js';
import {
  VisualAdoptionService,
  type FirstAdoptCommand,
} from './visual-adoption.js';

function actionName(input: Record<string, unknown>) {
  if (typeof input.action !== 'string' || input.action.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A result-delivery action is required.',
    );
  }
  return input.action;
}

function payload(input: Record<string, unknown>) {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A result-delivery payload is required.',
    );
  }
  return value as Record<string, unknown>;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new VisualAdoptionError(
      'INVALID_COMMAND',
      parsed.error.message,
      400,
    );
  }
  return parsed.data;
}

/**
 * Independent FoundationModule for visual-adoption / result-delivery.
 * Does not add methods to OperationsApplicationService (S1 freeze).
 */
export class ResultDeliveryFoundationModule implements P1OperationModule {
  readonly name = 'result-delivery';

  constructor(private readonly visualAdoption: VisualAdoptionService) {}

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }) {
    const action = actionName(args.input);
    const value = payload(args.input);

    switch (action) {
      case 'adopt_into_content_package': {
        // First-adopt path — same command name/payload as operations, via port.
        const command = parse(adoptIntoContentPackageCommandSchema, value);
        return this.visualAdoption.firstAdopt(
          args.context,
          command satisfies FirstAdoptCommand,
          args.idempotencyKey,
        );
      }
      case 'revise_content_package_visuals': {
        const command = parse(reviseContentPackageVisualsCommandSchema, value);
        return this.visualAdoption.reviseContentPackageVisuals(
          args.context,
          command,
          args.idempotencyKey,
        );
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown result-delivery command ${action}.`,
        );
    }
  }

  async query(_args: {
    context: P1Context;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    throw new P1DomainError(
      'INVALID_STATE',
      'result-delivery does not expose queries yet.',
    );
  }
}

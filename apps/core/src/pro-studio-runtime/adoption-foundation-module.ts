import { z } from 'zod';

import type { P1Context } from '../p1/foundation/domain.js';
import type { P1OperationModule } from '../p1/foundation/ports.js';
import {
  AdvancedCanvasAdoptionError,
  type AdvancedCanvasAdoptionPort,
} from './adoption.js';

const identifierSchema = z.string().trim().min(1).max(200);
const adoptionPayloadSchema = z.strictObject({
  projectId: identifierSchema,
  revisionRef: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('frozen'),
      revisionId: identifierSchema,
    }),
    z.strictObject({
      expectedDraftVersion: z.number().int().positive(),
      kind: z.literal('freeze_current_draft'),
    }),
  ]),
  selection: z.strictObject({
    orderedMediaNodeIds: z.array(identifierSchema).min(1).max(100),
    textNodeId: identifierSchema.optional(),
  }),
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('new_package') }),
    z.strictObject({
      baseVersionId: identifierSchema,
      expectedRevision: z.number().int().nonnegative(),
      kind: z.literal('existing_package'),
      packageId: identifierSchema,
    }),
  ]),
});
const listAdoptionsPayloadSchema = z.strictObject({
  projectId: identifierSchema,
});

export class AdvancedCanvasAdoptionFoundationModule
  implements P1OperationModule
{
  readonly name = 'advanced-canvas';

  constructor(private readonly adoption: AdvancedCanvasAdoptionPort) {}

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }) {
    if (args.input.action !== 'adopt_advanced_canvas_output') {
      throw new AdvancedCanvasAdoptionError(
        'INPUT_INVALID',
        `Unknown advanced canvas adoption command ${String(args.input.action)}.`,
      );
    }
    const payload = adoptionPayloadSchema.safeParse(args.input.payload);
    if (!payload.success) {
      throw new AdvancedCanvasAdoptionError(
        'INPUT_INVALID',
        'Advanced canvas adoption input is invalid.',
      );
    }
    return this.adoption.adopt(adoptionContext(args.context), {
      ...payload.data,
      idempotencyKey: args.idempotencyKey,
    });
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    if (args.input.action !== 'list_adoptions') {
      throw new AdvancedCanvasAdoptionError(
        'INPUT_INVALID',
        `Unknown advanced canvas adoption query ${String(args.input.action)}.`,
      );
    }
    const payload = listAdoptionsPayloadSchema.safeParse(args.input.payload);
    if (!payload.success) {
      throw new AdvancedCanvasAdoptionError(
        'INPUT_INVALID',
        'Advanced canvas adoption query is invalid.',
      );
    }
    return this.adoption.listAdoptions(
      adoptionContext(args.context),
      payload.data.projectId,
    );
  }
}

function adoptionContext(context: P1Context) {
  return {
    correlationId: context.correlationId,
    userId: context.userId,
    workspaceId: context.workspaceId,
  };
}

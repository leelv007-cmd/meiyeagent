import type { P1ModuleRequest } from '@meiye/contracts';

type P1Module = P1ModuleRequest['module'];

export const p1QueryKeys = {
  all: ['p1'] as const,
  module: (module: P1Module) => ['p1', module] as const,
  request: (
    module: P1Module,
    action: string,
    payload: Record<string, unknown> = {}
  ) => ['p1', module, action, payload] as const,
};

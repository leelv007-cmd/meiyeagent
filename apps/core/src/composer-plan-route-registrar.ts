import type { RouteTable } from './route-table.js';

export type ComposerPlanTaskRoute = { workspaceId: string; taskId: string };

export function registerComposerPlanCommandRoutes(input: {
  routes: RouteTable;
  pathname: string;
  startAvailable: boolean;
  reviseAvailable: boolean;
  onStart(route: ComposerPlanTaskRoute): Promise<void>;
  onRevise(route: ComposerPlanTaskRoute): Promise<void>;
}): void {
  const start = taskRoute(input.pathname, 'start');
  input.routes.add('composer-task-start', [
    'POST',
    () => input.startAvailable && Boolean(start),
    'service-token',
    () => input.onStart(start!),
  ]);

  const revise = taskRoute(input.pathname, 'revise');
  input.routes.add('composer-task-revise', [
    'POST',
    () => input.reviseAvailable && Boolean(revise),
    'service-token',
    () => input.onRevise(revise!),
  ]);
}

function taskRoute(
  pathname: string,
  command: 'start' | 'revise',
): ComposerPlanTaskRoute | null {
  const match = pathname.match(
    new RegExp(
      `^/v1/workspaces/([^/]+)/p1/composer/tasks/([^/]+)/${command}$`,
      'u',
    ),
  );
  if (!match?.[1] || !match[2]) return null;
  try {
    return {
      workspaceId: decodeURIComponent(match[1]),
      taskId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

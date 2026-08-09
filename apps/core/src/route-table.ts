export type RouteAuthClass = 'public' | 'service-token';
type RouteMethod = '*' | 'DELETE' | 'GET' | 'POST' | 'PUT';
type RouteHandler = () => Promise<void> | void;
type RouteMatcher = () => boolean;

export const CORE_ROUTE_AUTH_CLASSES = [
  ['health', 'public'],
  ['health-assembly', 'public'],
  ['health-ready', 'public'],
  ['capabilities', 'public'],
  ['workspace-bootstrap', 'service-token'],
  ['e2e-credit-detail-fixture', 'service-token'],
  ['e2e-user-selected-skill-fixture', 'service-token'],
  ['e2e-user-selected-skill-evidence', 'service-token'],
  ['public-plan-catalog', 'service-token'],
  ['pending-actions', 'service-token'],
  ['pending-interrupts-list', 'service-token'],
  ['pending-interrupts-resume', 'service-token'],
  ['composer-destination-map', 'service-token'],
  ['composer-submissions', 'service-token'],
  ['campaign-paid-work-start', 'service-token'],
  ['campaign-paid-work-status', 'service-token'],
  ['composer-task-events', 'service-token'],
  ['composer-content-package', 'service-token'],
  ['agent-semantic-replay', 'service-token'],
  ['agent-semantic-events', 'service-token'],
  ['harness-recommendation', 'service-token'],
  ['harness-product-metrics', 'service-token'],
  ['harness-active-tasks', 'service-token'],
  ['harness-task-admission', 'service-token'],
  ['harness-interaction', 'service-token'],
  ['harness-interaction-message', 'service-token'],
  ['harness-interaction-renderer', 'service-token'],
  ['harness-interaction-editing', 'service-token'],
  ['harness-decision', 'service-token'],
  ['confirmation-create', 'service-token'],
  ['confirmation-list-pending', 'service-token'],
  ['confirmation-decide', 'service-token'],
  ['confirmation-expire', 'service-token'],
  ['workflow-events', 'service-token'],
  ['canvas-text-stream', 'service-token'],
  ['assistant-stream', 'service-token'],
  ['assets', 'service-token'],
  ['diagnostics-create-retired', 'service-token'],
  ['product-state', 'service-token'],
  ['product-commands', 'service-token'],
  ['p1-commands', 'service-token'],
  ['p1-query', 'service-token'],
  ['diagnostic-events', 'service-token'],
  ['diagnostic-resume-retired', 'service-token'],
] as const satisfies ReadonlyArray<readonly [string, RouteAuthClass]>;

export type CoreRouteId = (typeof CORE_ROUTE_AUTH_CLASSES)[number][0];

const AUTH_CLASS_BY_ROUTE = new Map<string, RouteAuthClass>(
  CORE_ROUTE_AUTH_CLASSES
);

export class RouteTable {
  private readonly entries: Array<{
    authClass: RouteAuthClass;
    handler: RouteHandler;
    matcher: RouteMatcher;
    method: RouteMethod;
  }> = [];

  add(
    id: CoreRouteId,
    [method, matcher, authClass, handler]: readonly [
      RouteMethod,
      RouteMatcher,
      RouteAuthClass,
      RouteHandler,
    ]
  ) {
    if (AUTH_CLASS_BY_ROUTE.get(id) !== authClass) {
      throw new Error(`Route ${id} has an inconsistent auth class.`);
    }
    this.entries.push({ authClass, handler, matcher, method });
  }

  async dispatch(input: {
    authorized: boolean;
    method: string | undefined;
    onUnauthorized(): void;
  }) {
    const publicRoute = this.match('public', input.method);
    if (publicRoute) {
      await publicRoute.handler();
      return true;
    }
    if (!input.authorized) {
      input.onUnauthorized();
      return true;
    }
    const protectedRoute = this.match('service-token', input.method);
    if (!protectedRoute) return false;
    await protectedRoute.handler();
    return true;
  }

  private match(authClass: RouteAuthClass, method: string | undefined) {
    return this.entries.find(
      (entry) =>
        entry.authClass === authClass &&
        (entry.method === '*' || entry.method === method) &&
        entry.matcher()
    );
  }
}

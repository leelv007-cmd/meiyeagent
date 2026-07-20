export function workspaceCoreFetchInit(
  request: Request,
  headers: Headers,
  body: string | undefined
): RequestInit {
  const lastEventId = request.headers.get('last-event-id');
  if (lastEventId) headers.set('last-event-id', lastEventId);
  return {
    body,
    headers,
    method: request.method,
    signal: request.signal,
  };
}

export type WorkspaceWorkflowEventResource = `p1/workflows/${string}/events`;
export type WorkspaceHarnessTaskCollectionResource = 'p1/harness/tasks';
export type WorkspacePendingActionsResource = 'p1/pending-actions';
export type WorkspaceHarnessDecisionResource =
  `p1/harness/tasks/${string}/decision`;
export type WorkspaceHarnessProductMetricResource =
  `p1/harness/tasks/${string}/product-metrics`;

export function workspaceWorkflowEventResource(
  workflowId: string
): WorkspaceWorkflowEventResource {
  return `p1/workflows/${encodeURIComponent(workflowId)}/events`;
}

export function workspaceHarnessDecisionResource(
  taskId: string
): WorkspaceHarnessDecisionResource {
  return `p1/harness/tasks/${encodeURIComponent(taskId)}/decision`;
}

export function workspaceHarnessProductMetricResource(
  taskId: string
): WorkspaceHarnessProductMetricResource {
  return `p1/harness/tasks/${encodeURIComponent(taskId)}/product-metrics`;
}

export function workspaceCoreUpstreamPath(
  workspaceId: string,
  resource: string,
  requestUrl: string
) {
  return `/v1/workspaces/${encodeURIComponent(workspaceId)}/${resource}${new URL(requestUrl).search}`;
}

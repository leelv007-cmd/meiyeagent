export function workspaceCoreFetchInit(
  request: Request,
  headers: Headers,
  body: string | undefined
): RequestInit {
  return {
    body,
    headers,
    method: request.method,
    signal: request.signal,
  };
}

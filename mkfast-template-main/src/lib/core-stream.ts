const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'x-correlation-id',
  'x-meiye-catalog-model-id',
  'x-meiye-stream-protocol',
  'x-vercel-ai-ui-message-stream',
  'x-accel-buffering',
] as const;

export function coreProxyResponseHeaders(source: Headers) {
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (
    headers.get('content-type')?.startsWith('text/event-stream') ||
    headers.has('x-meiye-stream-protocol') ||
    headers.has('x-vercel-ai-ui-message-stream')
  ) {
    headers.set('content-encoding', 'identity');
    headers.set('x-accel-buffering', 'no');
  }
  return headers;
}

export function coreProxyResponse(upstream: Response) {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: coreProxyResponseHeaders(upstream.headers),
  });
}

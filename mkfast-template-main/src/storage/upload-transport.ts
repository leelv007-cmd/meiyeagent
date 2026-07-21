export class PayloadTooLargeError extends Error {
  constructor() {
    super('Upload request body exceeds the allowed size');
    this.name = 'PayloadTooLargeError';
  }
}

export class UnsupportedUploadMediaTypeError extends Error {
  constructor() {
    super('Upload request must use multipart/form-data');
    this.name = 'UnsupportedUploadMediaTypeError';
  }
}

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number
): Promise<Uint8Array> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isFinite(declaredBytes) || declaredBytes > maxBytes) {
      throw new PayloadTooLargeError();
    }
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function parseBoundedFormData(
  request: Request,
  maxBytes: number
): Promise<FormData> {
  const contentType = request.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new UnsupportedUploadMediaTypeError();
  }
  const body = await readBoundedRequestBody(request, maxBytes);
  const responseBody = new Uint8Array(body.byteLength);
  responseBody.set(body);
  return new Response(responseBody.buffer, {
    headers: { 'content-type': contentType },
  }).formData();
}

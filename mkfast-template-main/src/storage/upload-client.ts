import type { UploadPurpose } from './upload-policy';

export async function uploadThroughBoundedRoute<T>(
  formData: FormData,
  purpose: UploadPurpose
): Promise<T> {
  const response = await fetch(
    `/api/storage/upload?purpose=${encodeURIComponent(purpose)}`,
    { body: formData, method: 'POST' }
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? 'Upload failed');
  }
  return (await response.json()) as T;
}

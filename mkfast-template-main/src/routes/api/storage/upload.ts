import { createFileRoute } from '@tanstack/react-router';
import { createAuth } from '@/auth/auth';
import { resolveActiveWorkspace } from '@/db/workspaces';
import { requireWorkspaceCapability } from '@/lib/workspace-authorization';
import { UploadError } from '@/storage/types';
import {
  parseBoundedFormData,
  PayloadTooLargeError,
  UnsupportedUploadMediaTypeError,
} from '@/storage/upload-transport';
import { uploadProductAsset, uploadUserFile } from '@/storage/upload-service';

const MAX_UPLOAD_REQUEST_BYTES = 11 * 1024 * 1024;

export const Route = createFileRoute('/api/storage/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => handleUpload(request),
    },
  },
});

async function handleUpload(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const purpose = url.searchParams.get('purpose');
  if (
    purpose !== 'avatar' &&
    purpose !== 'private_file' &&
    purpose !== 'product_asset'
  ) {
    return Response.json({ error: 'Invalid upload purpose' }, { status: 400 });
  }

  const session = await createAuth().api.getSession({
    headers: request.headers,
  });
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.emailVerified) {
    return Response.json(
      { code: 'email_not_verified', error: 'Email not verified' },
      { status: 403 }
    );
  }
  const workspace = await resolveActiveWorkspace(session.user.id);
  if (!workspace) {
    return Response.json({ error: 'Workspace not found' }, { status: 404 });
  }

  try {
    const formData = await parseBoundedFormData(
      request,
      MAX_UPLOAD_REQUEST_BYTES
    );
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'File not provided' }, { status: 400 });
    }
    const requestOrigin = url.origin;

    if (purpose === 'product_asset') {
      requireWorkspaceCapability(workspace.role, 'content.create');
      const uploadIdValue = formData.get('uploadId');
      const uploadId =
        typeof uploadIdValue === 'string' &&
        /^[a-zA-Z0-9-]{1,100}$/u.test(uploadIdValue)
          ? uploadIdValue
          : undefined;
      const contentHashValue = formData.get('contentHash');
      const contentHash =
        typeof contentHashValue === 'string' &&
        /^[a-f0-9]{64}$/u.test(contentHashValue)
          ? contentHashValue
          : undefined;
      if (uploadId && !contentHash) {
        return Response.json(
          { error: 'File hash is required' },
          { status: 400 }
        );
      }
      return Response.json(
        await uploadProductAsset({
          contentHash,
          file,
          requestOrigin,
          uploadId,
          userId: session.user.id,
          workspaceId: workspace.id,
        })
      );
    }

    const descriptionValue = formData.get('description');
    const description =
      typeof descriptionValue === 'string' && descriptionValue.trim()
        ? descriptionValue.trim().slice(0, 500)
        : undefined;
    return Response.json(
      await uploadUserFile({
        description,
        file,
        purpose,
        requestOrigin,
        userId: session.user.id,
        workspaceId: workspace.id,
      })
    );
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return Response.json({ error: error.message }, { status: 413 });
    }
    if (error instanceof UnsupportedUploadMediaTypeError) {
      return Response.json({ error: error.message }, { status: 415 });
    }
    if (error instanceof UploadError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: 'Upload failed' }, { status: 500 });
  }
}

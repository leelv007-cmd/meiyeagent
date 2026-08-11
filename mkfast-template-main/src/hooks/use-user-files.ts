import { useMutation } from '@tanstack/react-query';
import { uploadThroughBoundedRoute } from '@/storage/upload-client';

/**
 * Uploads a file to the avatars folder
 */
export function useUploadUserAvatar() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return uploadThroughBoundedRoute<{ key: string; url: string }>(
        form,
        'avatar'
      );
    },
  });
}

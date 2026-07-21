import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { deleteUserFile, listUserFiles } from '@/api/user-files';
import { uploadThroughBoundedRoute } from '@/storage/upload-client';

export const userFilesKeys = {
  all: ['user-files'] as const,
  lists: () => [...userFilesKeys.all, 'lists'] as const,
  list: (params: { pageIndex: number; pageSize: number }) =>
    [...userFilesKeys.lists(), params] as const,
};

/**
 * Fetches a list of user files
 */
export function useUserFiles(pageIndex: number, pageSize: number) {
  return useQuery({
    queryKey: userFilesKeys.list({ pageIndex, pageSize }),
    queryFn: () => listUserFiles({ data: { pageIndex, pageSize } }),
    placeholderData: keepPreviousData,
  });
}

/**
 * Deletes a user file
 */
export function useDeleteUserFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteUserFile({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userFilesKeys.all });
    },
  });
}

/**
 * Uploads a user file
 */
export function useUploadUserFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { file: File; description?: string }) => {
      const form = new FormData();
      form.append('file', params.file);
      if (params.description != null && params.description !== '') {
        form.append('description', params.description);
      }
      return uploadThroughBoundedRoute<{ key: string; url: string }>(
        form,
        'private_file'
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userFilesKeys.all });
    },
  });
}

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

import { authClient } from '@/auth/client';
import { listUsers } from '@/api/users';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnSort } from '@tanstack/react-table';

type UsersSortingState = ColumnSort[];

interface SimpleFilter {
  id: string;
  value: string;
}

export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'lists'] as const,
  list: (params: {
    pageIndex: number;
    pageSize: number;
    search: string;
    sorting: UsersSortingState;
    filters: SimpleFilter[];
  }) => [...usersKeys.lists(), params] as const,
};

/**
 * Fetch users with pagination, search, sort, filters
 */
export function useUsers(
  pageIndex: number,
  pageSize: number,
  search: string,
  sorting: UsersSortingState,
  filters: SimpleFilter[]
) {
  return useQuery({
    queryKey: usersKeys.list({
      pageIndex,
      pageSize,
      search,
      sorting,
      filters,
    }),
    queryFn: async () => {
      const first = sorting[0];
      const sortId = first?.id ?? 'createdAt';
      const sortDesc = first?.desc ?? true;
      const roleFilter = filters.find((f) => f.id === 'role');
      const statusFilter = filters.find((f) => f.id === 'status');
      const status =
        statusFilter?.value === 'active' || statusFilter?.value === 'inactive'
          ? statusFilter.value
          : undefined;
      return listUsers({
        data: {
          pageIndex,
          pageSize,
          search,
          sortId,
          sortDesc,
          role: roleFilter?.value,
          status,
        },
      });
    },
  });
}

/**
 * Ban user via Better Auth admin plugin
 */
export function useBanUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (opts: {
      userId: string;
      banReason: string;
      banExpiresIn?: number;
    }) =>
      authClient.admin.banUser({
        userId: opts.userId,
        banReason: opts.banReason,
        banExpiresIn: opts.banExpiresIn,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.all });
    },
  });
}

/**
 * Unban user via Better Auth admin plugin
 */
export function useUnbanUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (opts: { userId: string }) =>
      authClient.admin.unbanUser({ userId: opts.userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.all });
    },
  });
}

export type SetPlatformRoleInput = {
  userId: string;
  /** Platform roles only: admin | user (merchant). */
  role: 'admin' | 'user';
  reason: string;
};

export class SetPlatformRoleError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SetPlatformRoleError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Platform role change via the custom #366 set-role handler.
 * Requires userId, target role, and a non-empty reason (not native BA setRole).
 */
export function useSetPlatformRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (opts: SetPlatformRoleInput) => {
      const response = await fetch('/api/auth/admin/set-role', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: opts.userId,
          role: opts.role,
          reason: opts.reason,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            user?: { id?: string; role?: string };
            audit?: Record<string, unknown>;
            error?:
              | string
              | { code?: string; message?: string };
            code?: string;
          }
        | null;

      if (!response.ok) {
        const nested =
          body && typeof body.error === 'object' && body.error
            ? body.error
            : null;
        const code =
          nested?.code ??
          (typeof body?.code === 'string' ? body.code : undefined) ??
          (typeof body?.error === 'string' ? body.error : undefined) ??
          'ROLE_CHANGE_FAILED';
        const message =
          nested?.message ??
          (typeof body?.error === 'string' ? body.error : undefined) ??
          'Failed to change role.';
        throw new SetPlatformRoleError(code, message, response.status);
      }

      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.all });
    },
  });
}

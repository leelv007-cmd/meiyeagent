import type { AdminUserListItem } from '@/api/users';

type UserActionTarget = Pick<AdminUserListItem, 'id' | 'banned' | 'role'>;

/** Ban is only legal for an identified, currently active account. */
export function canBanUser(user: UserActionTarget): boolean {
  return Boolean(user.id) && !user.banned;
}

/** Unban is only legal for an identified, currently banned account. */
export function canUnbanUser(user: UserActionTarget): boolean {
  return Boolean(user.id) && Boolean(user.banned);
}

/**
 * Platform role change is available whenever the target is identified.
 * Reason emptiness is a form-level gate (same as the detail panel button).
 */
export function canSetPlatformRole(user: UserActionTarget): boolean {
  return Boolean(user.id);
}

export function isPlatformAdmin(user: UserActionTarget): boolean {
  return user.role === 'admin';
}

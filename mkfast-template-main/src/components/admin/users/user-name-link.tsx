import type { AdminUserListItem } from '@/api/users';
import { UserAvatar } from '@/components/shared/user-avatar';
import { Link } from '@tanstack/react-router';

/** Name cell: avatar + deep-link into the route-owned detail sheet. */
export function UserNameLink({ user }: { user: AdminUserListItem }) {
  return (
    <div className="flex items-center gap-2">
      <UserAvatar
        name={user.name ?? null}
        image={user.image ?? null}
        className="size-8 shrink-0 border"
      />
      <Link
        to="/admin/users/$userId"
        params={{ userId: user.id }}
        className="w-fit px-0 text-left font-medium text-foreground hover:underline hover:underline-offset-4"
        data-testid="user-name-link"
      >
        {user.name}
      </Link>
    </div>
  );
}

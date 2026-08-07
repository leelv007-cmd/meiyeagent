import {
  UserDetailErrorState,
  UserDetailLoadingState,
  UserDetailNotFoundState,
  UserDetailSheet,
} from '@/components/admin/users/user-detail-viewer';
import { useUser } from '@/hooks/use-users';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/users/$userId')({
  component: AdminUserDetailRoute,
  errorComponent: UserDetailErrorState,
});

function AdminUserDetailRoute() {
  const { userId } = Route.useParams();
  const userQuery = useUser(userId);

  if (userQuery.isPending) {
    return <UserDetailLoadingState />;
  }

  if (userQuery.isError) {
    return <UserDetailErrorState />;
  }

  const user = userQuery.data;
  if (!user) {
    return <UserDetailNotFoundState />;
  }

  return <UserDetailSheet user={user} />;
}

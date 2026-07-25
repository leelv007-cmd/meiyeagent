import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@/auth/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usersKeys } from '@/hooks/use-users';
import {
  admin_users_columns_email,
  admin_users_columns_name,
  admin_users_create,
  admin_users_create_description,
  admin_users_create_error,
  admin_users_create_success,
  admin_users_create_title,
  admin_users_temporary_password,
  admin_users_temporary_password_placeholder,
} from '@/locale/paraglide/messages';
import {
  canCreateAdminUser,
  type AdminCreateUserInput,
} from './admin-create-user';

export function AdminCreateUserForm() {
  const queryClient = useQueryClient();
  const [input, setInput] = useState<AdminCreateUserInput>({
    name: '',
    email: '',
    password: '',
  });
  const [isPending, setIsPending] = useState(false);
  const canCreate = canCreateAdminUser(input);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate || isPending) return;
    setIsPending(true);
    try {
      const result = await authClient.admin.createUser({
        name: input.name.trim(),
        email: input.email.trim(),
        password: input.password,
        role: 'user',
      });
      if (result.error) throw result.error;
      setInput({ name: '', email: '', password: '' });
      await queryClient.invalidateQueries({ queryKey: usersKeys.all });
      toast.success(admin_users_create_success());
    } catch {
      toast.error(admin_users_create_error());
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{admin_users_create_title()}</CardTitle>
        <CardDescription>{admin_users_create_description()}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-2">
            <Label htmlFor="admin-create-user-name">
              {admin_users_columns_name()}
            </Label>
            <Input
              id="admin-create-user-name"
              autoComplete="off"
              value={input.name}
              onChange={(event) =>
                setInput((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="admin-create-user-email">
              {admin_users_columns_email()}
            </Label>
            <Input
              id="admin-create-user-email"
              autoComplete="off"
              type="email"
              value={input.email}
              onChange={(event) =>
                setInput((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="admin-create-user-password">
              {admin_users_temporary_password()}
            </Label>
            <Input
              id="admin-create-user-password"
              autoComplete="new-password"
              minLength={8}
              placeholder={admin_users_temporary_password_placeholder()}
              type="password"
              value={input.password}
              onChange={(event) =>
                setInput((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
            />
          </div>
          <Button
            className="self-end"
            disabled={!canCreate || isPending}
            type="submit"
          >
            {admin_users_create()}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

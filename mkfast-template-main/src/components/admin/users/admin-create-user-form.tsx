import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@/auth/client';
import { Button } from '@/components/ui/button';
import { FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { IconPlus } from '@tabler/icons-react';
import { usersKeys } from '@/hooks/use-users';
import {
  admin_users_close,
  admin_users_columns_email,
  admin_users_columns_name,
  admin_users_create,
  admin_users_create_description,
  admin_users_create_error,
  admin_users_create_problem_email,
  admin_users_create_problem_name,
  admin_users_create_problem_password,
  admin_users_create_success,
  admin_users_create_title,
  admin_users_temporary_password,
  admin_users_temporary_password_placeholder,
} from '@/locale/paraglide/messages';
import {
  canCreateAdminUser,
  type AdminCreateUserInput,
} from './admin-create-user';

type FieldName = keyof AdminCreateUserInput;

const FIELD_PROBLEM: Record<FieldName, () => string> = {
  name: admin_users_create_problem_name,
  email: admin_users_create_problem_email,
  password: admin_users_create_problem_password,
};

// A field's own verdict, isolated by holding the other two at known-good values.
// `canCreateAdminUser` stays the single rule — the email pattern and the length
// floor are never restated here — and the operator gets told which field is
// blocking Create instead of facing a disabled button with no reason.
const KNOWN_GOOD: AdminCreateUserInput = {
  name: 'x',
  email: 'x@example.com',
  password: 'x'.repeat(8),
};

function fieldProblem(
  field: FieldName,
  input: AdminCreateUserInput
): string | null {
  const isolated = canCreateAdminUser({ ...KNOWN_GOOD, [field]: input[field] });
  return isolated ? null : FIELD_PROBLEM[field]();
}

export function AdminCreateUserForm({
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const queryClient = useQueryClient();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const [input, setInput] = useState<AdminCreateUserInput>({
    name: '',
    email: '',
    password: '',
  });
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>(
    {}
  );
  const [isPending, setIsPending] = useState(false);
  const canCreate = canCreateAdminUser(input);

  const edit =
    (field: FieldName) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setInput((current) => ({ ...current, [field]: value }));
    };
  const errorFor = (field: FieldName) =>
    touched[field] ? fieldProblem(field, input) : null;

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
      setTouched({});
      await queryClient.invalidateQueries({ queryKey: usersKeys.all });
      toast.success(admin_users_create_success());
      setOpen(false);
    } catch {
      toast.error(admin_users_create_error());
    } finally {
      setIsPending(false);
    }
  };

  const fields: {
    id: string;
    name: FieldName;
    label: string;
    inputProps: React.ComponentProps<typeof Input>;
  }[] = [
    {
      id: 'admin-create-user-name',
      name: 'name',
      label: admin_users_columns_name(),
      inputProps: { autoComplete: 'off' },
    },
    {
      id: 'admin-create-user-email',
      name: 'email',
      label: admin_users_columns_email(),
      inputProps: { autoComplete: 'off', type: 'email' },
    },
    {
      id: 'admin-create-user-password',
      name: 'password',
      label: admin_users_temporary_password(),
      inputProps: {
        autoComplete: 'new-password',
        minLength: 8,
        type: 'password',
        placeholder: admin_users_temporary_password_placeholder(),
      },
    },
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          trigger ?? (
            <Button data-testid="admin-create-user-trigger">
              <IconPlus />
              {admin_users_create_title()}
            </Button>
          )
        }
      />
      <SheetContent
        side="right"
        className="z-50 flex flex-col gap-0 overflow-hidden rounded-xl bg-popover p-0 outline-none data-[side=right]:inset-y-4 data-[side=right]:right-4 data-[side=right]:left-auto data-[side=right]:h-[calc(100svh-2rem)] data-[side=right]:w-[min(30rem,calc(100vw-2rem))] data-[side=right]:max-w-none data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="border-b px-5 py-4 sm:px-6">
          <SheetTitle>{admin_users_create_title()}</SheetTitle>
          <SheetDescription>
            {admin_users_create_description()}
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          id="admin-create-user-form"
          onSubmit={handleSubmit}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 sm:px-6">
            {fields.map((field) => {
              const problem = errorFor(field.name);
              return (
                <div key={field.id} className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={field.id}>{field.label}</FieldLabel>
                  <Input
                    id={field.id}
                    value={input[field.name]}
                    onChange={edit(field.name)}
                    onBlur={() =>
                      setTouched((current) => ({
                        ...current,
                        [field.name]: true,
                      }))
                    }
                    aria-invalid={!!problem}
                    {...field.inputProps}
                  />
                  {problem ? <FieldError>{problem}</FieldError> : null}
                </div>
              );
            })}
          </div>

          <SheetFooter className="flex-row justify-end border-t px-5 py-4 sm:px-6">
            <SheetClose render={<Button type="button" variant="outline" />}>
              {admin_users_close()}
            </SheetClose>
            <Button disabled={!canCreate || isPending} type="submit">
              {admin_users_create()}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

import {
  settings_security_update_password_current_password,
  settings_security_update_password_current_required,
  settings_security_update_password_description,
  settings_security_update_password_fail,
  settings_security_update_password_hide_password,
  settings_security_update_password_hint,
  settings_security_update_password_new_min_length,
  settings_security_update_password_new_password,
  settings_security_update_password_placeholder_current,
  settings_security_update_password_placeholder_new,
  settings_security_update_password_save,
  settings_security_update_password_saving,
  settings_security_update_password_show_password,
  settings_security_update_password_success,
  settings_security_update_password_title,
} from '@/locale/paraglide/messages';
import { FormError } from '@/components/shared/form-error';
import { Button } from '@/components/ui/button';
import {
  SettingsRow,
  SettingsRowFooter,
  SettingsRowHeader,
} from '@/components/settings/settings-section';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { authClient } from '@/auth/client';
import { cn } from '@/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
const passwordSchema = z.object({
  currentPassword: z.string().min(1, {
    message: settings_security_update_password_current_required(),
  }),
  newPassword: z
    .string()
    .min(8, { message: settings_security_update_password_new_min_length() }),
});
interface UpdatePasswordCardProps {
  className?: string;
}
export function UpdatePasswordCard({ className }: UpdatePasswordCardProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | undefined>('');
  const { data: session } = authClient.useSession();
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const user = session?.user;
  if (!user) return null;
  const onSubmit = async (values: z.infer<typeof passwordSchema>) => {
    await authClient.changePassword(
      {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
      },
      {
        onRequest: () => {
          setIsSaving(true);
          setError('');
        },
        onResponse: () => {
          setIsSaving(false);
        },
        onSuccess: () => {
          toast.success(settings_security_update_password_success());
          form.reset();
        },
        onError: () => {
          setError(settings_security_update_password_fail());
          toast.error(settings_security_update_password_fail());
        },
      }
    );
  };
  return (
    <SettingsRow className={cn(className)}>
      <SettingsRowHeader
        description={settings_security_update_password_description()}
        title={settings_security_update_password_title()}
      />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {settings_security_update_password_current_password()}
                </FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showCurrent ? 'text' : 'password'}
                      placeholder={settings_security_update_password_placeholder_current()}
                      {...field}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowCurrent(!showCurrent)}
                  >
                    {showCurrent ? (
                      <IconEyeOff className="size-4" />
                    ) : (
                      <IconEye className="size-4" />
                    )}
                    <span className="sr-only">
                      {showCurrent
                        ? settings_security_update_password_hide_password()
                        : settings_security_update_password_show_password()}
                    </span>
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {settings_security_update_password_new_password()}
                </FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showNew ? 'text' : 'password'}
                      placeholder={settings_security_update_password_placeholder_new()}
                      {...field}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowNew(!showNew)}
                  >
                    {showNew ? (
                      <IconEyeOff className="size-4" />
                    ) : (
                      <IconEye className="size-4" />
                    )}
                    <span className="sr-only">
                      {showNew
                        ? settings_security_update_password_hide_password()
                        : settings_security_update_password_show_password()}
                    </span>
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormError message={error} />
          <SettingsRowFooter hint={settings_security_update_password_hint()}>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? settings_security_update_password_saving()
                : settings_security_update_password_save()}
            </Button>
          </SettingsRowFooter>
        </form>
      </Form>
    </SettingsRow>
  );
}

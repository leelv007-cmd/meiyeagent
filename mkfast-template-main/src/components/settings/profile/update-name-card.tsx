import {
  settings_profile_name_description,
  settings_profile_name_fail,
  settings_profile_name_hint,
  settings_profile_name_max_length,
  settings_profile_name_min_length,
  settings_profile_name_placeholder,
  settings_profile_name_save,
  settings_profile_name_saving,
  settings_profile_name_success,
  settings_profile_name_title,
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
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
interface UpdateNameCardProps {
  className?: string;
}
const nameSchema = z.object({
  name: z
    .string()
    .min(3, { message: settings_profile_name_min_length() })
    .max(30, { message: settings_profile_name_max_length() }),
});
export function UpdateNameCard({ className }: UpdateNameCardProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { data: session, refetch } = authClient.useSession();
  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: session?.user?.name || '' },
  });
  useEffect(() => {
    if (session?.user?.name) form.setValue('name', session.user.name);
  }, [session, form]);
  const user = session?.user;
  if (!user) return null;
  const onSubmit = async (values: z.infer<typeof nameSchema>) => {
    if (values.name === session?.user?.name) return;
    await authClient.updateUser(
      { name: values.name },
      {
        onRequest: () => {
          setIsSaving(true);
          setError('');
        },
        onResponse: () => {
          setIsSaving(false);
        },
        onSuccess: () => {
          toast.success(settings_profile_name_success());
          refetch();
          form.reset({ name: values.name });
        },
        onError: () => {
          setError(settings_profile_name_fail());
          toast.error(settings_profile_name_fail());
        },
      }
    );
  };
  return (
    <SettingsRow className={cn(className)}>
      <SettingsRowHeader
        description={settings_profile_name_description()}
        title={settings_profile_name_title()}
      />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                {/*
                    The group title above already says 「名字」. Printing it again
                    as a field label put the same word twice in one group, so the
                    label stays for screen readers and drops out of the layout.
                  */}
                <FormLabel className="sr-only">
                  {settings_profile_name_title()}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder={settings_profile_name_placeholder()}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormError message={error} />
          <SettingsRowFooter hint={settings_profile_name_hint()}>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? settings_profile_name_saving()
                : settings_profile_name_save()}
            </Button>
          </SettingsRowFooter>
        </form>
      </Form>
    </SettingsRow>
  );
}

import {
  contact_email,
  contact_email_invalid,
  contact_error,
  contact_form_title,
  contact_message,
  contact_message_max,
  contact_message_min,
  contact_name,
  contact_name_max,
  contact_name_min,
  contact_placeholder_email,
  contact_placeholder_message,
  contact_placeholder_name,
  contact_send,
  contact_sending,
  contact_success,
} from '@/locale/paraglide/messages';
import { sendContactMessage } from '@/api/contact';
import { FormError } from '@/components/shared/form-error';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
const schema = z.object({
  name: z.string().min(3, contact_name_min()).max(30, contact_name_max()),
  email: z.email(contact_email_invalid()),
  message: z
    .string()
    .min(10, contact_message_min())
    .max(500, contact_message_max()),
});
type FormValues = z.infer<typeof schema>;
export function ContactFormCard() {
  const [error, setError] = useState<string | undefined>();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', message: '' },
  });
  const isPending = form.formState.isSubmitting;
  async function onSubmit(values: FormValues) {
    setError(undefined);
    try {
      await sendContactMessage({ data: values });
      toast.success(contact_success());
      form.reset();
    } catch {
      const msg = contact_error();
      setError(msg);
      toast.error(msg);
    }
  }
  return (
    <Card className="mx-auto max-w-lg overflow-hidden pt-6 pb-0">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">
          {contact_form_title()}
        </CardTitle>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{contact_name()}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={contact_placeholder_name()}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{contact_email()}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={contact_placeholder_email()}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{contact_message()}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={contact_placeholder_message()}
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormError message={error} />
          </CardContent>
          <CardFooter className="mt-6 flex items-center justify-between rounded-none border-t bg-muted px-6 py-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? contact_sending() : contact_send()}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

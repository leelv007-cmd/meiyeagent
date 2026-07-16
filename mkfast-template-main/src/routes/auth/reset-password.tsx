import {
  auth_reset_password_description,
  auth_reset_password_title,
} from '@/locale/paraglide/messages';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { websiteConfig } from '@/config/website';
import { Routes } from '@/lib/routes';

export const Route = createFileRoute('/auth/reset-password')({
  beforeLoad: () => {
    if (!websiteConfig.auth?.enable) {
      throw redirect({ to: Routes.Root });
    }
  },
  component: ResetPasswordPage,
  head: () => ({
    meta: [
      { title: auth_reset_password_title() },
      { name: 'description', content: auth_reset_password_description() },
    ],
  }),
});

function ResetPasswordPage() {
  return <ResetPasswordForm />;
}

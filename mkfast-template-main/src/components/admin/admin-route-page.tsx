import { CanonicalPage } from '@/components/uiux/canonical-page';
import { shell_admin_brand } from '@/locale/paraglide/messages';
import type { ReactNode } from 'react';

export function AdminRoutePage({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <CanonicalPage
      section={shell_admin_brand()}
      title={title}
      description={description}
    >
      {children}
    </CanonicalPage>
  );
}

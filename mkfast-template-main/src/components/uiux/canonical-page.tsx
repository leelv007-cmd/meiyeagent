import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { ObjectEvidence } from './object-evidence';
import { StatePanel } from './state-panel';
import {
  canonical_page_empty_description,
  canonical_page_empty_title,
} from '@/locale/paraglide/messages';
import type { ReactNode } from 'react';

interface CanonicalPageProps {
  children?: ReactNode;
  description: string;
  evidence?: {
    id: string;
    kind: 'Task' | 'Work' | 'Job' | 'Asset' | 'Content' | 'Session';
    source?: string;
  };
  section: string;
  title: string;
}

export function CanonicalPage({
  children,
  description,
  evidence,
  section,
  title,
}: CanonicalPageProps) {
  return (
    <DashboardLayout
      breadcrumbs={[
        { label: section, isCurrentPage: false },
        { label: title, isCurrentPage: true },
      ]}
      description={description}
      title={title}
    >
      {evidence ? <ObjectEvidence {...evidence} /> : null}
      {children ?? (
        <StatePanel
          kind="empty"
          title={canonical_page_empty_title()}
          description={canonical_page_empty_description()}
        />
      )}
    </DashboardLayout>
  );
}

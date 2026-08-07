/**
 * #426: record-crumb trail for supply views deep links.
 * When a page publishes useRecordCrumb(name), the section above becomes a
 * link again (no aria-current="page") and the record name is the current page.
 */
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AdminBreadcrumbs } from './admin-breadcrumbs';
import { RecordCrumbProvider, useRecordCrumb } from './page-crumb';

const routerState = vi.hoisted(() => ({
  pathname: '/admin/supply/views/model',
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: routerState.pathname } }),
  Link: ({ children, to, ...rest }: { children?: ReactNode; to?: string }) => (
    <a href={typeof to === 'string' ? to : '#'} {...rest}>
      {children}
    </a>
  ),
}));

function PublishRecordCrumb({ label }: { label: string }) {
  useRecordCrumb(label);
  return <AdminBreadcrumbs />;
}

describe('AdminBreadcrumbs record crumb', () => {
  it('views deep link demotes the supply section and shows the record name', async () => {
    routerState.pathname = '/admin/supply/views/model';
    render(
      <RecordCrumbProvider>
        <PublishRecordCrumb label="model" />
      </RecordCrumbProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('model')).toBeInTheDocument();
    });

    const record = screen.getByText('model');
    expect(record.getAttribute('aria-current')).toBe('page');

    const section = screen.getByText('供给运行控制台');
    expect(section.getAttribute('aria-current')).not.toBe('page');
    expect(section.closest('[aria-current="page"]')).toBeNull();
  });
});

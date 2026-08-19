/**
 * 旧任务详情路由壳 — T34 / #228 + LINK-01 / R-P1-09.
 *
 * A single task has no page of its own after the reshell. The mapping table
 * sends the id to the workbench Composer bound to that task instead of
 * dropping it on a bare dashboard home.
 */

import {
  canonicalDeepLinkRedirectHref,
  resolveCanonicalDeepLink,
} from '@/product/canonical-deep-link';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/tasks_/$taskId')({
  beforeLoad: ({ params }) => {
    const pathname = `/dashboard/tasks/${params.taskId}`;
    const destination = resolveCanonicalDeepLink({ pathname, search: {} });
    const href = canonicalDeepLinkRedirectHref(pathname, destination);
    throw redirect({
      href: href ?? `/dashboard?taskId=${encodeURIComponent(params.taskId)}`,
      replace: true,
    });
  },
});

/**
 * 旧任务详情路由壳 — T34 / #228.
 *
 * A single task has no page of its own after the reshell: 待办 are settled in
 * the pending-actions inbox and 对话内任务卡, both of which live on the
 * workbench. There is no per-task destination to forward to, so the id is
 * dropped and the shell lands on the workbench.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { resolveLegacyRedirect } from '@/lib/uiux/navigation';

export const Route = createFileRoute('/dashboard/tasks_/$taskId')({
  beforeLoad: () => {
    throw redirect({ href: resolveLegacyRedirect('/dashboard/tasks')! });
  },
});

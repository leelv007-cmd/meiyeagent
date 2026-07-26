/**
 * 旧内容详情路由壳 — T34 / #228.
 *
 * The path parameter here has always been a ContentPackage id, and the new
 * detail route resolves one directly (`workDetail` matches by package id before
 * work id), so this is a one-to-one forward rather than a drop to the list.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/content_/$contentId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/works/$workId',
      params: { workId: params.contentId },
    });
  },
});

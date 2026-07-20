import { createFileRoute } from '@tanstack/react-router';

import {
  resolveOrdinaryToolRoute,
  validateOrdinaryToolSearch,
} from '@/product/composer/tool-route-model';

export const Route = createFileRoute('/dashboard/tools_/$toolEntryId')({
  validateSearch: validateOrdinaryToolSearch,
  component: OrdinaryToolPage,
});

function OrdinaryToolPage() {
  const { toolEntryId } = Route.useParams();
  const search = Route.useSearch();
  const resolved = resolveOrdinaryToolRoute(toolEntryId, search);

  if (resolved.kind !== 'ok') {
    return (
      <main className="mx-auto max-w-2xl p-6" role="alert">
        该创作工具不可用或交接参数无效。
      </main>
    );
  }

  return (
    <main
      className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col gap-4 p-6"
      data-testid="ordinary-tool-page"
      data-tool-entry-id={resolved.handoff.toolEntryId}
    >
      <a href={resolved.backHref} className="text-sm text-primary">
        返回创作目录
      </a>
      <h1 className="text-xl font-semibold">{resolved.title}</h1>
      <p className="text-sm text-muted-foreground">{resolved.summary}</p>
      <output className="rounded-2xl border border-input p-4">
        已进入工具工作区；打开与返回不会创建 Work、Task、Job 或 ContentPackage。
      </output>
    </main>
  );
}

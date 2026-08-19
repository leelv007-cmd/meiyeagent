import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useWorkspaceAccess } from '@/p1/use-workspace-access';
import { useCanonicalHandoffQuery } from './canonical-handoff-query';
import { handedOverReceiptFixture } from './delivery-assisted-model';

const workspaceAccess = vi.hoisted(() => ({
  value: {
    data: undefined as { id: string; role: 'owner' } | undefined,
    isFetching: false,
    isPending: true,
  },
}));

vi.mock('@/p1/use-workspace-access', () => ({
  useWorkspaceAccess: () => workspaceAccess.value,
}));

afterEach(cleanup);

function WorkspaceScopedHandoff(props: {
  submit: (
    action: string,
    payload: Record<string, unknown>
  ) => Promise<unknown>;
}) {
  const workspace = useWorkspaceAccess('user-with-two-memberships');
  if (workspace.isPending || workspace.isFetching) {
    return <output data-testid="handoff-kind" />;
  }
  if (!workspace.data?.id) {
    return <output data-testid="handoff-kind">not_found</output>;
  }
  return (
    <ResolvedWorkspaceHandoff
      submit={props.submit}
      workspaceId={workspace.data.id}
    />
  );
}

function ResolvedWorkspaceHandoff(props: {
  submit: (
    action: string,
    payload: Record<string, unknown>
  ) => Promise<unknown>;
  workspaceId: string;
}) {
  const handoff = useCanonicalHandoffQuery({
    canShareFiles: false,
    nowIso: () => '2026-07-20T10:00:00.000Z',
    origin: 'https://app.example',
    submit: props.submit,
    token: 'canonical-live-token-1234',
    userId: 'user-with-two-memberships',
    workspaceId: props.workspaceId,
  });
  return (
    <output data-testid="handoff-kind">{handoff.data?.resolve.kind}</output>
  );
}

it('waits for the server-resolved default workspace before consuming a handoff', async () => {
  workspaceAccess.value = {
    data: undefined,
    isFetching: false,
    isPending: true,
  };
  const submit = vi.fn().mockResolvedValue({ kind: 'not_found' });
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <WorkspaceScopedHandoff submit={submit} />
    </QueryClientProvider>
  );

  expect(submit).not.toHaveBeenCalled();
  workspaceAccess.value = {
    data: { id: 'workspace-earliest', role: 'owner' },
    isFetching: false,
    isPending: false,
  };
  view.rerender(
    <QueryClientProvider client={client}>
      <WorkspaceScopedHandoff submit={submit} />
    </QueryClientProvider>
  );

  await waitFor(() =>
    expect(screen.getByTestId('handoff-kind')).toHaveTextContent('not_found')
  );
  expect(submit).toHaveBeenCalledTimes(1);
});

it('uses the server-resolved default workspace for the ready receipt projection', async () => {
  const fixture = handedOverReceiptFixture();
  const receipt = {
    ...fixture,
    binding: {
      ...fixture.binding!,
      workspaceId: 'workspace-earliest',
    },
    workspaceId: 'workspace-earliest',
  };
  workspaceAccess.value = {
    data: { id: 'workspace-earliest', role: 'owner' },
    isFetching: false,
    isPending: false,
  };
  const submit = vi.fn().mockResolvedValue({
    handoff: {
      assistedReceipt: receipt,
      body: '正文',
      checklist: [],
      contentPackageRevision: 1,
      conversionText: '',
      expiresAt: '2026-07-23T09:05:00.000Z',
      exportReceiptId: 'export-1',
      media: [],
      packageId: 'pkg-1',
      platform: 'xiaohongshu',
      sharePath: '/dashboard/handoff/canonical-live-token-1234',
      title: '标题',
      token: 'canonical-live-token-1234',
      topics: [],
      variantVersionId: 'variant-v1',
    },
    kind: 'ok',
    receipt,
    revision: 1,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceScopedHandoff submit={submit} />
    </QueryClientProvider>
  );

  await waitFor(() =>
    expect(screen.getByTestId('handoff-kind')).toHaveTextContent('ready')
  );
  expect(submit).toHaveBeenCalledTimes(1);
});

it('returns not_found without consuming when the server has no active workspace', () => {
  workspaceAccess.value = {
    data: undefined,
    isFetching: false,
    isPending: false,
  };
  const submit = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceScopedHandoff submit={submit} />
    </QueryClientProvider>
  );

  expect(screen.getByTestId('handoff-kind')).toHaveTextContent('not_found');
  expect(submit).not.toHaveBeenCalled();
});

it('does not consume through a cached workspace while server authority is revalidating', () => {
  workspaceAccess.value = {
    data: { id: 'workspace-stale', role: 'owner' },
    isFetching: true,
    isPending: false,
  };
  const submit = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceScopedHandoff submit={submit} />
    </QueryClientProvider>
  );

  expect(screen.getByTestId('handoff-kind')).toHaveTextContent('');
  expect(submit).not.toHaveBeenCalled();
});

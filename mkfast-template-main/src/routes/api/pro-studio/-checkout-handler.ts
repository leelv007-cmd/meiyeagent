import { ProStudioCommerceError } from '@/payment/pro-studio-commerce';

export interface CheckoutIdentity {
  sessionId: string;
  userEmail: string;
  userId: string;
  userName: string;
}

export interface CheckoutDependencies {
  authenticate(request: Request): Promise<CheckoutIdentity | null>;
  resolveWorkspace(userId: string): Promise<{ id: string } | undefined>;
  start(input: CheckoutIdentity & { workspaceId: string }): Promise<string>;
}

export async function handleProStudioCheckoutRequest(
  request: Request,
  dependencies: CheckoutDependencies
) {
  const identity = await dependencies.authenticate(request);
  if (!identity) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspace = await dependencies.resolveWorkspace(identity.userId);
  if (!workspace) {
    return Response.json({ error: 'Workspace not found' }, { status: 404 });
  }
  try {
    const url = await dependencies.start({
      ...identity,
      workspaceId: workspace.id,
    });
    return Response.redirect(url, 303);
  } catch (error) {
    if (error instanceof ProStudioCommerceError) {
      const status =
        error.code === 'OWNER_REQUIRED'
          ? 403
          : error.code === 'ACTIVATION_PENDING' ||
              error.code === 'ALREADY_PURCHASED'
            ? 409
            : 503;
      return Response.json({ error: error.code }, { status });
    }
    throw error;
  }
}

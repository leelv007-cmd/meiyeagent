export const ADMIN_ASSISTED_ACCOUNT_POLICY = {
  // D-128: an operator-provisioned account uses the merchant assembly chain,
  // while the operator owns the supplied contact address during handoff.
  emailVerified: true,
} as const;

export function stripAdminProvisioningAttribution(
  data: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!data) return data;
  const { provisionedByUserId: _ignored, ...safeData } = data;
  return safeData;
}

export function applyAdminAssistedAccountPolicy(
  data: Record<string, unknown> | undefined,
  actorUserId: string
): Record<string, unknown> {
  return {
    ...stripAdminProvisioningAttribution(data),
    emailVerified: ADMIN_ASSISTED_ACCOUNT_POLICY.emailVerified,
    provisionedByUserId: actorUserId,
  };
}

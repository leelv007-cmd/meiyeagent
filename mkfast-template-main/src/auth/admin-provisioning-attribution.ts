export function secureAdminProvisioningData(
  data: Record<string, unknown> | undefined,
  actorUserId: string
): Record<string, unknown> {
  return {
    ...data,
    emailVerified: true,
    provisionedByUserId: actorUserId,
  };
}

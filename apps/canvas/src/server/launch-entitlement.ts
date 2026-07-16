import type { ProStudioEntitlementContext } from "@meiye/core/pro-studio-runtime";

type LaunchInput = {
	mainSessionId: string;
	userId: string;
	workspaceId: string;
};

type LaunchEntitlementDependencies = {
	assertCanEnter(context: ProStudioEntitlementContext): Promise<void>;
	resolveRole(
		input: Pick<LaunchInput, "userId" | "workspaceId">,
	): Promise<"operator" | "owner" | "reviewer" | null>;
	validateMainSession(input: LaunchInput): Promise<boolean>;
};

export async function canIssueProStudioLaunch(
	input: LaunchInput,
	dependencies: LaunchEntitlementDependencies,
) {
	if (!(await dependencies.validateMainSession(input))) return false;
	const role = await dependencies.resolveRole(input);
	if (!role) return false;
	try {
		await dependencies.assertCanEnter({
			correlationId: `launch-${crypto.randomUUID()}`,
			role,
			userId: input.userId,
			workspaceId: input.workspaceId,
		});
		return true;
	} catch {
		return false;
	}
}

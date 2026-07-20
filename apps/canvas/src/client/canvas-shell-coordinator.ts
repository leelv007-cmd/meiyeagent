import type {
	LaunchCodeAudience,
	LaunchCodeContext,
} from "@meiye/core/pro-studio";

export type CanvasLaunchAudience = LaunchCodeAudience;

export type CanvasBootstrapAppearance = Partial<
	Pick<NonNullable<LaunchCodeContext["bootstrap"]>, "locale" | "theme">
>;

type CanvasAppearancePorts = {
	applyLanguage(locale: string): void;
	applyTheme(theme: "dark" | "light"): void;
	prefersDark(): boolean;
	subscribeToSystemTheme(listener: () => void): () => void;
};

export function applyCanvasBootstrapAppearance(
	bootstrap: CanvasBootstrapAppearance | undefined,
	ports: CanvasAppearancePorts,
) {
	ports.applyLanguage(bootstrap?.locale?.trim() || "zh-CN");
	const configuredTheme = bootstrap?.theme ?? "system";
	const applyResolvedTheme = () => {
		ports.applyTheme(
			configuredTheme === "system"
				? ports.prefersDark()
					? "dark"
					: "light"
				: configuredTheme,
		);
	};
	applyResolvedTheme();
	return configuredTheme === "system"
		? ports.subscribeToSystemTheme(applyResolvedTheme)
		: () => undefined;
}

export function projectIdFromAudience(audience: CanvasLaunchAudience) {
	return audience.kind === "project" ? audience.projectId : null;
}

export function kernelInsertPosition(nodeCount: number) {
	const index = Math.max(0, Math.floor(nodeCount));
	return {
		x: 80 + (index % 3) * 260,
		y: 80 + Math.floor(index / 3) * 220,
	};
}

export async function applyAndPersistKernelGraph<TGraph, TSaved>(input: {
	applyGraph(graph: TGraph): void;
	graph: TGraph;
	persistDraft(): Promise<TSaved>;
}) {
	input.applyGraph(input.graph);
	return input.persistDraft();
}

export async function runAfterDirtyDraftFlush<T>(input: {
	action(): Promise<T>;
	flushDraft(): Promise<unknown>;
	isDirty(): boolean;
}) {
	if (input.isDirty()) await input.flushDraft();
	return input.action();
}

export function warnBeforeCanvasUnload(
	isDirty: boolean,
	event: { preventDefault(): void; returnValue: string },
) {
	if (!isDirty) return false;
	event.preventDefault();
	event.returnValue = "";
	return true;
}

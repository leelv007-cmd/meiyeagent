/**
 * Derivative of Vozeb's use-canvas-ui-store.ts.
 *
 * This is deliberately a host-local session projection: it carries interaction
 * preferences only and is never handed to ProjectPersistenceAdapter.
 */
export type CanvasSessionState = {
	activePanel: "runtime";
	selectedNodeIds: string[];
	toolbar: {
		backgroundMode: "lines";
	};
	viewport: { scale: number; x: number; y: number };
};

export function createCanvasSessionState(
	input: Partial<CanvasSessionState> = {},
): CanvasSessionState {
	return {
		activePanel: input.activePanel ?? "runtime",
		selectedNodeIds: [...(input.selectedNodeIds ?? [])],
		toolbar: { backgroundMode: input.toolbar?.backgroundMode ?? "lines" },
		viewport: {
			scale: input.viewport?.scale ?? 1,
			x: input.viewport?.x ?? 0,
			y: input.viewport?.y ?? 0,
		},
	};
}

export function withSelectedCanvasNodes(
	session: CanvasSessionState,
	selectedNodeIds: string[],
): CanvasSessionState {
	return { ...session, selectedNodeIds: [...selectedNodeIds] };
}

export function withCanvasViewport(
	session: CanvasSessionState,
	viewport: CanvasSessionState["viewport"],
): CanvasSessionState {
	return { ...session, viewport: { ...viewport } };
}

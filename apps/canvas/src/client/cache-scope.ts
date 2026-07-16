export function canvasCacheNamespace(input: {
	schemaVersion: number;
	userId: string;
	workspaceId: string;
}) {
	return `canvas:v${input.schemaVersion}:${input.userId}:${input.workspaceId}`;
}

export interface CanvasCacheCleanupPorts {
	abortInFlight(): void;
	broadcastLogout(): void;
	clearBlobCache(): Promise<void>;
	clearIndexedDb(): Promise<void>;
	clearLocalForage(): Promise<void>;
}

export async function clearSensitiveCanvasCaches(
	ports: CanvasCacheCleanupPorts,
) {
	ports.abortInFlight();
	await ports.clearIndexedDb();
	await ports.clearLocalForage();
	await ports.clearBlobCache();
	ports.broadcastLogout();
}

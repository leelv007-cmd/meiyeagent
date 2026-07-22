import type { MouseEvent as ReactMouseEvent } from "react";
// biome-ignore lint/correctness/noUnusedImports: tsx executes this authorized derivative with the classic React JSX runtime.
import React from "react";
import { canvasThemes } from "@/lib/canvas-theme";
import type {
	CanvasConnection,
	CanvasNodeData,
} from "@/src/vendor/vozeb/app/(user)/canvas/types";
import { useThemeStore } from "@/stores/use-theme-store";

export function PortedConnectionPath({
	connection,
	from,
	to,
	active,
	onSelect,
	onContextMenu,
}: {
	connection: CanvasConnection;
	from: CanvasNodeData;
	to: CanvasNodeData;
	active: boolean;
	onSelect: () => void;
	onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
	const theme = canvasThemes[useThemeStore((state) => state.theme)];
	const startX = from.position.x + from.width;
	const startY = from.position.y + from.height / 2;
	const endX = to.position.x;
	const endY = to.position.y + to.height / 2;
	const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
	const path = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
	return (
		<g>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: SVG connection hit areas cannot be expressed as HTML buttons. */}
			<path
				data-connection-id={connection.id}
				d={path}
				fill="none"
				onClick={(event) => {
					event.stopPropagation();
					onSelect();
				}}
				onContextMenu={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onContextMenu?.(event);
				}}
				stroke="transparent"
				strokeWidth="16"
				style={{ cursor: "pointer", pointerEvents: "stroke" }}
			/>
			<path
				d={path}
				fill="none"
				stroke={active ? theme.node.activeStroke : theme.node.muted}
				strokeOpacity={active ? 1 : 0.82}
				strokeWidth={active ? 3 : 2}
				style={{
					filter: active
						? `drop-shadow(0 0 8px ${theme.node.activeStroke}66)`
						: undefined,
					pointerEvents: "none",
				}}
			/>
		</g>
	);
}

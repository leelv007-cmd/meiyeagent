"use client";

import { useSyncExternalStore } from "react";
import type { CanvasColorTheme } from "@/lib/canvas-theme";

type ThemeState = {
	setTheme(theme: CanvasColorTheme): void;
	theme: CanvasColorTheme;
};

const listeners = new Set<() => void>();

function setTheme(theme: CanvasColorTheme) {
	if (state.theme === theme) return;
	state = { ...state, theme };
	for (const listener of listeners) listener();
}

let state: ThemeState = { setTheme, theme: "dark" };

export function setCanvasTheme(theme: CanvasColorTheme) {
	setTheme(theme);
}

export function useThemeStore<T>(selector: (state: ThemeState) => T): T {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => selector(state),
		() => selector(state),
	);
}

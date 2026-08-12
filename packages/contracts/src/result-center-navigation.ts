/** Shareable Result Center panel keys (D-089). */
export const resultPanels = [
  'result',
  'adjust',
  'delivery',
  'history',
  'run',
] as const;

export type ResultPanel = (typeof resultPanels)[number];

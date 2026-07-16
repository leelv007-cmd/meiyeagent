export interface LightCanvasTextElement {
  fill?: string;
  fontFamily?: string;
  fontSize?: number;
  height: number;
  id: string;
  kind: 'text';
  opacity?: number;
  rotation: number;
  text: string;
  width: number;
  x: number;
  y: number;
}

export interface LightCanvasImageElement {
  assetId: string;
  height: number;
  id: string;
  kind: 'image';
  opacity?: number;
  rotation: number;
  sourceJobId?: string;
  src?: string;
  width: number;
  x: number;
  y: number;
}

export type LightCanvasElement =
  | LightCanvasImageElement
  | LightCanvasTextElement;

export interface LightCanvasDocument {
  height: number;
  pages: Array<{ elements: LightCanvasElement[]; id: string }>;
  width: number;
}

type LightComposerEdit =
  | { elementId: string; text: string; type: 'edit_text' }
  | {
      assetId: string;
      crop?: { height: number; width: number; x: number; y: number };
      elementId: string;
      src?: string;
      type: 'replace_image';
    }
  | { elementId: string; targetIndex: number; type: 'reorder_module' };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('light Composer document values must be objects.');
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`light Composer ${field} must be a finite number.`);
  }
  return value;
}

function positive(value: unknown, field: string) {
  const parsed = number(value, field);
  if (parsed <= 0) throw new Error(`light Composer ${field} must be positive.`);
  return parsed;
}

function string(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`light Composer ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string) {
  return value === undefined ? undefined : number(value, field);
}

function optionalString(value: unknown, field: string) {
  return value === undefined ? undefined : string(value, field);
}

function parseElement(value: unknown): LightCanvasElement {
  const raw = record(value);
  const custom =
    raw.custom && typeof raw.custom === 'object' && !Array.isArray(raw.custom)
      ? (raw.custom as Record<string, unknown>)
      : {};
  const item: Record<string, unknown> = {
    ...raw,
    kind: raw.kind ?? raw.type,
    rotation: raw.rotation ?? 0,
    assetId: raw.assetId ?? custom.productAssetId,
  };
  if (item.kind !== 'text' && item.kind !== 'image') {
    throw new Error('light Composer supports only text and image modules.');
  }
  const base = {
    height: positive(item.height, 'element height'),
    id: string(item.id, 'element id'),
    rotation: number(item.rotation, 'element rotation'),
    width: positive(item.width, 'element width'),
    x: number(item.x, 'element x'),
    y: number(item.y, 'element y'),
    ...(optionalNumber(item.opacity, 'element opacity') === undefined
      ? {}
      : { opacity: optionalNumber(item.opacity, 'element opacity') }),
  };
  if (item.kind === 'text') {
    return {
      ...base,
      kind: 'text',
      text: typeof item.text === 'string' ? item.text : '',
      ...(optionalString(item.fill, 'text fill')
        ? { fill: item.fill as string }
        : {}),
      ...(optionalString(item.fontFamily, 'font family')
        ? { fontFamily: item.fontFamily as string }
        : {}),
      ...(optionalNumber(item.fontSize, 'font size') === undefined
        ? {}
        : { fontSize: optionalNumber(item.fontSize, 'font size') }),
    };
  }
  if (item.kind === 'image') {
    return {
      ...base,
      assetId: string(item.assetId, 'image assetId'),
      kind: 'image',
      ...(optionalString(item.sourceJobId, 'source job id')
        ? { sourceJobId: item.sourceJobId as string }
        : {}),
      ...(optionalString(item.src, 'image src')
        ? { src: item.src as string }
        : {}),
    };
  }
  throw new Error('light Composer supports only text and image modules.');
}

export function parseLightCanvasDocument(value: unknown): LightCanvasDocument {
  const root = record(value);
  if (!Array.isArray(root.pages) || root.pages.length === 0) {
    throw new Error('light Composer requires at least one page.');
  }
  return {
    height: positive(root.height, 'document height'),
    pages: root.pages.map((value) => {
      const page = record(value);
      const elements = Array.isArray(page.elements)
        ? page.elements
        : page.children;
      if (!Array.isArray(elements)) {
        throw new Error('light Composer page elements must be an array.');
      }
      return {
        elements: elements.map(parseElement),
        id: string(page.id, 'page id'),
      };
    }),
    width: positive(root.width, 'document width'),
  };
}

function assertCrop(
  crop: NonNullable<
    Extract<LightComposerEdit, { type: 'replace_image' }>['crop']
  >
) {
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (
    values.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1 ||
    crop.y + crop.height > 1
  ) {
    throw new Error('light Composer crop must stay inside the source image.');
  }
}

export function applyLightComposerEdit(
  source: LightCanvasDocument,
  edit: LightComposerEdit
): LightCanvasDocument {
  const document = structuredClone(source);
  const page = document.pages.find((candidate) =>
    candidate.elements.some((element) => element.id === edit.elementId)
  );
  const index = page?.elements.findIndex(
    (element) => element.id === edit.elementId
  );
  if (!page || index === undefined || index < 0) {
    throw new Error('light Composer module was not found.');
  }
  const element = page.elements[index]!;
  if (edit.type === 'edit_text') {
    if (element.kind !== 'text') {
      throw new Error('light Composer copy edits require a text module.');
    }
    element.text = edit.text;
    return document;
  }
  if (edit.type === 'replace_image') {
    if (element.kind !== 'image') {
      throw new Error('light Composer image edits require an image module.');
    }
    element.assetId = string(edit.assetId, 'image assetId');
    if (edit.src) element.src = edit.src;
    if (edit.crop) {
      assertCrop(edit.crop);
      element.x += element.width * edit.crop.x;
      element.y += element.height * edit.crop.y;
      element.width *= edit.crop.width;
      element.height *= edit.crop.height;
    }
    return document;
  }
  if (!Number.isInteger(edit.targetIndex)) {
    throw new Error('light Composer module position must be an integer.');
  }
  const targetIndex = Math.max(
    0,
    Math.min(page.elements.length - 1, edit.targetIndex)
  );
  page.elements.splice(index, 1);
  page.elements.splice(targetIndex, 0, element);
  return document;
}

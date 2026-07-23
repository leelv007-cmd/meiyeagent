export type RetouchCropRect = {
	height: number;
	width: number;
	x: number;
	y: number;
};

export type RetouchCropHandle =
	| "e"
	| "n"
	| "ne"
	| "nw"
	| "s"
	| "se"
	| "sw"
	| "w";

export type RetouchCropBox = {
	height: number;
	width: number;
};

const MIN_CROP_SIZE = 0.06;

/** Ratio in displayed pixels, not normalized canvas coordinates. */
export function cropDisplayAspectRatio(
	crop: RetouchCropRect,
	box: RetouchCropBox,
) {
	return (crop.width * box.width) / Math.max(1, crop.height * box.height);
}

export function moveRetouchCrop(
	crop: RetouchCropRect,
	dx: number,
	dy: number,
): RetouchCropRect {
	return {
		...crop,
		x: clamp(crop.x + dx, 0, 1 - crop.width),
		y: clamp(crop.y + dy, 0, 1 - crop.height),
	};
}

/** Resize against the dragged handle while preserving a saved display aspect. */
export function resizeRetouchCrop(input: {
	aspectRatio?: number | null;
	box: RetouchCropBox;
	crop: RetouchCropRect;
	dx: number;
	dy: number;
	handle: RetouchCropHandle;
}): RetouchCropRect {
	const { box, crop, dx, dy, handle } = input;
	const raw = rawResize(crop, dx, dy, handle);
	const aspectRatio = input.aspectRatio;
	if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
		return clampFreeResize(raw);
	}

	const normalizedRatio = (aspectRatio * box.height) / Math.max(1, box.width);
	const nextWidth = lockedWidth({
		crop,
		handle,
		normalizedRatio,
		raw,
	});
	const nextHeight = nextWidth / normalizedRatio;
	const x = handle.includes("w") ? crop.x + crop.width - nextWidth : crop.x;
	const y = handle.includes("n") ? crop.y + crop.height - nextHeight : crop.y;
	return {
		height: nextHeight,
		width: nextWidth,
		x: clamp(x, 0, 1 - nextWidth),
		y: clamp(y, 0, 1 - nextHeight),
	};
}

function rawResize(
	crop: RetouchCropRect,
	dx: number,
	dy: number,
	handle: RetouchCropHandle,
) {
	const next = { ...crop };
	if (handle.includes("e")) next.width += dx;
	if (handle.includes("s")) next.height += dy;
	if (handle.includes("w")) {
		next.x += dx;
		next.width -= dx;
	}
	if (handle.includes("n")) {
		next.y += dy;
		next.height -= dy;
	}
	return next;
}

function clampFreeResize(crop: RetouchCropRect): RetouchCropRect {
	const width = clamp(crop.width, MIN_CROP_SIZE, 1);
	const height = clamp(crop.height, MIN_CROP_SIZE, 1);
	return {
		height,
		width,
		x: clamp(crop.x, 0, 1 - width),
		y: clamp(crop.y, 0, 1 - height),
	};
}

function lockedWidth(input: {
	crop: RetouchCropRect;
	handle: RetouchCropHandle;
	normalizedRatio: number;
	raw: RetouchCropRect;
}) {
	const { crop, handle, normalizedRatio, raw } = input;
	const horizontal = handle.includes("e") || handle.includes("w");
	const vertical = handle.includes("n") || handle.includes("s");
	const widthScale = raw.width / crop.width;
	const heightScale = raw.height / crop.height;
	const desiredWidth =
		horizontal && !vertical
			? raw.width
			: vertical && !horizontal
				? raw.height * normalizedRatio
				: Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
					? raw.width
					: raw.height * normalizedRatio;
	const maxWidthFromX = handle.includes("w") ? crop.x + crop.width : 1 - crop.x;
	const maxHeightFromY = handle.includes("n")
		? crop.y + crop.height
		: 1 - crop.y;
	const minWidth = Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE * normalizedRatio);
	const maxWidth = Math.max(
		minWidth,
		Math.min(maxWidthFromX, maxHeightFromY * normalizedRatio),
	);
	return clamp(desiredWidth, minWidth, maxWidth);
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function seedanceReferenceLabel(kind: "audio" | "video", index: number) {
	return `${kind === "video" ? "视频" : "音频"}${index + 1}`;
}

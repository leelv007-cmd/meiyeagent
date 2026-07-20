import { deliveryUrl } from "./media-adapter";

export function KernelNodeMedia({
	assetId,
	type,
}: {
	assetId: string;
	type: "audio" | "image" | "video";
}) {
	const source = deliveryUrl(assetId);
	if (type === "image") {
		return (
			<div className="kernel-node-media">
				{/* biome-ignore lint/performance/noImgElement: private asset delivery is not an image optimizer source. */}
				<img alt="" draggable={false} src={source} />
			</div>
		);
	}
	const download = deliveryUrl(assetId, { download: true });
	return (
		<div className="kernel-node-media">
			{type === "video" ? (
				// biome-ignore lint/a11y/useMediaCaption: generated assets have no authoritative caption track.
				<video controls preload="metadata" src={source} />
			) : (
				// biome-ignore lint/a11y/useMediaCaption: generated assets have no authoritative caption track.
				<audio controls preload="metadata" src={source} />
			)}
			<a href={download}>{type === "video" ? "下载视频" : "下载音频"}</a>
		</div>
	);
}

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KernelNodeMedia } from "./kernel-node-media.js";

test("image node uses authenticated server delivery without a download control", () => {
	const markup = renderToStaticMarkup(
		createElement(KernelNodeMedia, {
			assetId: "image/asset-1",
			type: "image",
		}),
	);
	assert.match(
		markup,
		/<img[^>]*src="\/api\/canvas\/getAssetDelivery\?assetId=image%2Fasset-1"/u,
	);
	assert.doesNotMatch(markup, /download=1/u);
});

test("video node uses authenticated server delivery for playback and download", () => {
	const markup = renderToStaticMarkup(
		createElement(KernelNodeMedia, {
			assetId: "video/asset-1",
			type: "video",
		}),
	);
	assert.match(markup, /<video[^>]*controls=""/u);
	assert.match(
		markup,
		/src="\/api\/canvas\/getAssetDelivery\?assetId=video%2Fasset-1"/u,
	);
	assert.match(
		markup,
		/href="\/api\/canvas\/getAssetDelivery\?assetId=video%2Fasset-1&amp;download=1"/u,
	);
	assert.match(markup, />下载视频</u);
});

test("audio node uses authenticated server delivery for playback and download", () => {
	const markup = renderToStaticMarkup(
		createElement(KernelNodeMedia, {
			assetId: "audio-asset-1",
			type: "audio",
		}),
	);
	assert.match(markup, /<audio[^>]*controls=""/u);
	assert.match(
		markup,
		/src="\/api\/canvas\/getAssetDelivery\?assetId=audio-asset-1"/u,
	);
	assert.match(
		markup,
		/href="\/api\/canvas\/getAssetDelivery\?assetId=audio-asset-1&amp;download=1"/u,
	);
	assert.match(markup, />下载音频</u);
});

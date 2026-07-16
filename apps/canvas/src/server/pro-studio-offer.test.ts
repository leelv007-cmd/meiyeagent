import assert from "node:assert/strict";
import test from "node:test";
import { proStudioOffer } from "./pro-studio-offer.js";

test("leaves price authority to Main Web's canonical add-on catalog", () => {
	const offer = proStudioOffer({});
	assert.equal(offer.demoUrl, "/pro-studio#demo");
	assert.equal(offer.id, "pro-studio-unavailable");
	assert.equal(offer.purchasePath, "/api/pro-studio/checkout");
	assert.equal(offer.priceLabel, "价格由主应用确认");
	assert.doesNotMatch(offer.priceLabel, /¥299/u);
});

test("uses only the configured offer identity", () => {
	const offer = proStudioOffer({ PRO_STUDIO_OFFER_ID: "pro-studio-v1" });
	assert.equal(offer.id, "pro-studio-v1");
	assert.equal(offer.priceLabel, "价格由主应用确认");
});

import type { ProStudioOffer } from "@meiye/core/pro-studio-runtime";

export function proStudioOffer(
	environment: Record<string, string | undefined> = process.env as Record<
		string,
		string | undefined
	>,
): ProStudioOffer {
	return {
		demoUrl: "/pro-studio#demo",
		description:
			"Advanced Canvas generation, agent-assisted editing, and ContentPackage adoption.",
		id: environment.PRO_STUDIO_OFFER_ID?.trim() || "pro-studio-unavailable",
		priceLabel: "价格由主应用确认",
		purchasePath: "/api/pro-studio/checkout",
	};
}

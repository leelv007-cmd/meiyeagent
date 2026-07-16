import { handleProStudioPurchaseRequest } from "@/src/server/pro-studio-purchase-handler";
import { canvasRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return handleProStudioPurchaseRequest(request, canvasRuntime);
}

import { handleProStudioEntryRequest } from "@/src/server/pro-studio-entry-handler";
import { canvasRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return handleProStudioEntryRequest(request, canvasRuntime);
}

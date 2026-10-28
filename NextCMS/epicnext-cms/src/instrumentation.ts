import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
	error,
	request,
	context,
) => {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;

	const { logServerError } = await import("@/lib/server-log");
	logServerError("next.request_failed", error, {
		path: request.path.split("?", 1)[0] ?? request.path,
		method: request.method,
		routePath: context.routePath,
		routeType: context.routeType,
		renderSource: context.renderSource,
		digest:
			typeof error === "object" && error !== null && "digest" in error
				? String(error.digest)
				: null,
	});
};

export async function register() {
	if (
		process.env.NEXT_RUNTIME !== "nodejs" ||
		process.env.NEXT_PHASE === "phase-production-build"
	)
		return;
	const { drainFurnitureImports } = await import(
		"@/lib/services/furni-job-worker"
	);
	const timer = setInterval(() => {
		void drainFurnitureImports();
	}, 60000);
	timer.unref();
	const { sweepExpiredCloudflareBlocks } = await import("@/lib/cloudflare-api");
	const cloudflareSweep = setInterval(() => {
		void sweepExpiredCloudflareBlocks();
	}, 60000);
	cloudflareSweep.unref();

	// A deploy starts with an empty in-process cache, so prime the hot public
	// keys before traffic arrives instead of letting the first visitors each pay
	// for a miss. Never awaited: it must not delay the server becoming ready.
	const { warmPublicCaches } = await import("@/lib/services/cache-warmup");
	void warmPublicCaches();
}

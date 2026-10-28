import { createStore, runWithStore } from "./foundation/request-context";
import type { IpAddress } from "./foundation/types";
import { collectPerformance } from "./performance-diagnostics";
import { type PerformanceSample, recordPerformance } from "./performance-store";

type PublicRoute =
	| "/"
	| "/me"
	| "/news"
	| "/news/[slug]"
	| "/u/[username]"
	| "/events"
	| "/search";
/** Measures this server component invocation, not child rendering, streaming or browser load. */
export function withPublicPagePerformance<Props, Result>(
	route: PublicRoute,
	render: (props: Props) => Promise<Result>,
) {
	return async (props: Props): Promise<Result> => {
		if (
			process.env.NEXT_PHASE === "phase-production-build" ||
			process.env.NEXT_PHASE === "phase-production-compile"
		)
			return render(props);
		const store = createStore("unknown" as IpAddress);
		let outcome: PerformanceSample["outcome"] = "completed";
		return runWithStore(store, async () => {
			const result = await collectPerformance(
				async () => {
					try {
						return await render(props);
					} catch (error) {
						const digest =
							error && typeof error === "object" && "digest" in error
								? String(error.digest)
								: "";
						outcome = digest.startsWith("NEXT_REDIRECT;")
							? "redirect"
							: digest === "NEXT_HTTP_ERROR_FALLBACK;404"
								? "not-found"
								: "failed";
						throw error;
					}
				},
				(metrics) =>
					recordPerformance({
						kind: "public-page",
						outcome,
						operationId: store.requestId,
						route,
						method: "PAGE",
						status:
							outcome === "failed" ? 500 : outcome === "not-found" ? 404 : 200,
						at: Date.now(),
						streaming: false,
						metrics,
					}),
			);
			return result.value;
		});
	};
}

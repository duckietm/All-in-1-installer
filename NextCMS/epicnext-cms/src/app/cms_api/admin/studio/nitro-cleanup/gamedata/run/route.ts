import { apiError, apiJson, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import {
	cleanFigureData,
	cleanFigureMap,
	cleanFurnitureData,
	dedupeFurnitureData,
	GamedataCleanupLimitError,
	planGamedataCleanup,
} from "@/lib/furni/gamedata-dedupe";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";

/**
 * The passes, in the only order that is correct.
 *
 * `cleanFigureMap` has to run before `cleanFigureData`: dropping the part that
 * points at a set is exactly what makes that set unreferenced, so the other way
 * round deletes a set the map still names. Dedupe runs first so the orphan pass
 * judges a single row per classname.
 */
const PASSES = [
	"dedupeFurnitureData",
	"cleanFurnitureData",
	"cleanFigureMap",
	"cleanFigureData",
] as const;
type Pass = (typeof PASSES)[number];

function isPass(value: unknown): value is Pass {
	return PASSES.includes(value as Pass);
}

/**
 * Apply the selected gamedata cleanup passes. Destructive — the caller must
 * send `confirm: true` after showing the operator the preview from the sibling
 * GET route. `passes` defaults to all of them.
 *
 * Each pass caps how many rows it will delete (`maxRemovals`, default 500) and
 * writes a timestamped backup of every file it touches. A pass that would
 * exceed the cap throws before writing and the route answers 409 with what it
 * found, so raising the cap is always a separate, deliberate second call.
 */
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request, ctx) => {
		let body: {
			confirm?: unknown;
			passes?: unknown;
			maxRemovals?: unknown;
		};
		try {
			body = await request.json();
		} catch {
			return apiError("Invalid JSON body", 400);
		}

		if (body.confirm !== true)
			return apiError(
				"This rewrites gamedata JSON files; send confirm: true after reviewing the preview.",
				400,
			);

		let maxRemovals: number | undefined;
		if (body.maxRemovals !== undefined) {
			if (
				typeof body.maxRemovals !== "number" ||
				!Number.isFinite(body.maxRemovals) ||
				body.maxRemovals <= 0
			)
				return apiError("`maxRemovals` must be a positive number", 400);
			maxRemovals = Math.floor(body.maxRemovals);
		}

		let requested: Pass[] = [...PASSES];
		if (body.passes !== undefined) {
			if (!Array.isArray(body.passes))
				return apiError("`passes` must be an array", 400);
			const unknown = body.passes.filter((p) => !isPass(p));
			if (unknown.length > 0)
				return apiError(`Unknown pass: ${String(unknown[0])}`, 400);
			requested = PASSES.filter((pass) =>
				(body.passes as unknown[]).includes(pass),
			);
		}
		if (requested.length === 0)
			return apiError("No cleanup passes selected", 400);

		const options = maxRemovals === undefined ? undefined : { maxRemovals };
		const result: Record<string, unknown> = {};
		try {
			// Run in the fixed order above, not in the order the client listed
			// them, so a client cannot break the dependency by reordering.
			if (requested.includes("dedupeFurnitureData"))
				result.dedupeFurnitureData = await dedupeFurnitureData(options);
			if (requested.includes("cleanFurnitureData"))
				result.cleanFurnitureData = await cleanFurnitureData(options);
			if (requested.includes("cleanFigureMap"))
				result.cleanFigureMap = await cleanFigureMap(options);
			if (requested.includes("cleanFigureData"))
				result.cleanFigureData = await cleanFigureData(options);
		} catch (err) {
			if (err instanceof GamedataCleanupLimitError) {
				// Nothing was written by the pass that refused, so the files are
				// as they were. A preview tells the operator what to expect.
				const plan = await planGamedataCleanup();
				logAudit({
					userId: ctx.session.user.id,
					action: "nitro_cleanup_gamedata",
					target: "FurnitureData/FigureData/FigureMap",
					after: { passes: requested, refused: err.message, result },
				});
				return apiJson(
					{
						ok: false,
						error: err.message,
						pass: err.pass,
						wouldRemove: err.wouldRemove,
						maxRemovals: err.maxRemovals,
						partial: result,
						plan,
					},
					{ status: 409 },
				);
			}
			return apiError(
				`Gamedata cleanup failed: ${(err as Error).message}`,
				500,
			);
		}

		logAudit({
			userId: ctx.session.user.id,
			action: "nitro_cleanup_gamedata",
			target: "FurnitureData/FigureData/FigureMap",
			after: { passes: requested, result },
		});
		return apiOk({ result });
	},
);

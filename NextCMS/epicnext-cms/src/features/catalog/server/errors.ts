import "server-only";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";
import {
	CatalogConflict,
	CatalogInputError,
	CatalogNotFound,
} from "../domain/hierarchy";
export function catalogFailure(error: unknown) {
	if (error instanceof CatalogConflict)
		return { message: error.message, status: 409 };
	if (error instanceof CatalogNotFound)
		return { message: error.message, status: 404 };
	if (error instanceof CatalogInputError)
		return { message: error.message, status: 400 };
	if (error instanceof ZodError)
		return {
			message: error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; "),
			status: 400,
		};
	const reference = logger.error("Catalog operation failed", {
		module: "catalog",
		error,
	});
	return { message: `Catalog operation failed (${reference})`, status: 500 };
}

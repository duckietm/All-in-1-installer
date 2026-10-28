import { readCatalogRevision } from "@/features/catalog/server/catalog-revision";
import { apiJson, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";

/**
 * The staleness probe for every open admin catalog session. Returns the
 * revision `sendCatalogUpdate()` last wrote, so a client can tell whether its
 * tree is current with one tiny read instead of pulling the whole tree.
 */
export const GET = withAdmin({ permission: PERMS.CATALOG_VIEW }, async () => {
	const revision = await readCatalogRevision();
	if (!revision) return apiJson({ ok: true, revision: null });
	return apiOk({ revision }, { headers: { etag: `"${revision}"` } });
});

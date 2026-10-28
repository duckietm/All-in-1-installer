import { listSources } from "./clone-sources";
import { validateFurnitureAttachment } from "./furni-attachment";
import { browserHeaders } from "./import/core/browser-headers";

type Item = { classname: string; type: string; revision: number };
export interface RecoveredFurnitureSource {
	buffer: Buffer;
	sourceId: string;
	sourceName: string;
	revision: number;
}
type CatalogEntry = Pick<Item, "classname" | "revision">;
type Catalog = {
	roomitemtypes?: { furnitype?: CatalogEntry[] };
	wallitemtypes?: { furnitype?: CatalogEntry[] };
	furnitype?: CatalogEntry[];
};
function compactCatalog(raw: Catalog): Catalog {
	const entries = (value: unknown): CatalogEntry[] => {
		if (!Array.isArray(value)) return [];
		return value.slice(0, 100_000).flatMap((entry) => {
			if (
				!entry ||
				typeof entry.classname !== "string" ||
				entry.classname.length > 256 ||
				!Number.isSafeInteger(Number(entry.revision))
			)
				return [];
			return [{ classname: entry.classname, revision: Number(entry.revision) }];
		});
	};

	return {
		roomitemtypes: {
			furnitype: entries(raw?.roomitemtypes?.furnitype ?? raw?.furnitype),
		},
		wallitemtypes: { furnitype: entries(raw?.wallitemtypes?.furnitype) },
	};
}
const cache = new Map<string, { expires: number; catalog: Catalog | null }>();

async function boundedDownload(
	url: string,
	maxBytes: number,
	signal: AbortSignal,
) {
	const parsed = new URL(url);
	if (!["http:", "https:"].includes(parsed.protocol))
		throw Error("Unsupported source protocol");
	const response = await fetch(url, { signal, headers: browserHeaders() });
	if (
		!response.ok ||
		Number(response.headers.get("content-length")) > maxBytes ||
		!response.body
	) {
		await response.body?.cancel();
		throw Error("Source unavailable or too large");
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) throw Error("Source exceeds size limit");
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	return Buffer.concat(chunks, size);
}

/** Only exact classname/type/revision matches; never borrow another furniture's metadata. */
export async function recoverFurnitureNitro(
	item: Item,
	options: {
		excludeSourceId?: string;
		onAttempt?: (sourceName: string) => Promise<void>;
	} = {},
): Promise<RecoveredFurnitureSource | null> {
	if (!Number.isSafeInteger(item.revision) || item.revision <= 0) return null;
	const deadline = Date.now() + 20_000;
	const sources = (await listSources())
		.filter(
			(source) =>
				source.enabled !== false &&
				source.id !== options.excludeSourceId &&
				source.nitroBaseUrl &&
				source.furnidataUrl,
		)
		.slice(0, 8);
	for (const source of sources) {
		if (Date.now() >= deadline) break;
		// Await outside the catch: a lost worker lease must stop the import.
		await options.onAttempt?.(source.name);
		try {
			const signal = AbortSignal.timeout(
				Math.max(1, Math.min(4000, deadline - Date.now())),
			);
			let catalog = cache.get(source.furnidataUrl);
			if (!catalog || catalog.expires <= Date.now()) {
				let data: Catalog | null = null;
				try {
					data = compactCatalog(
						JSON.parse(
							(
								await boundedDownload(
									source.furnidataUrl,
									20 * 1024 * 1024,
									signal,
								)
							).toString("utf8"),
						),
					);
				} catch {
					/* Try the next configured source. */
				}
				if (cache.size >= 20) cache.clear();
				catalog = {
					expires: Date.now() + (data ? 300_000 : 60_000),
					catalog: data,
				};
				cache.set(source.furnidataUrl, catalog);
			}
			const entries =
				item.type === "flooritem"
					? (catalog.catalog?.roomitemtypes?.furnitype ??
						catalog.catalog?.furnitype)
					: catalog.catalog?.wallitemtypes?.furnitype;
			if (
				!Array.isArray(entries) ||
				!entries.some(
					(entry) =>
						entry.classname === item.classname &&
						Number(entry.revision) === item.revision,
				)
			)
				continue;
			if (Date.now() >= deadline) break;
			const base = encodeURIComponent(item.classname.split("*")[0]);
			const buffer = await boundedDownload(
				`${source.nitroBaseUrl.replace(/\/+$/, "")}/${base}.nitro`,
				50 * 1024 * 1024,
				AbortSignal.timeout(Math.max(1, Math.min(4000, deadline - Date.now()))),
			);
			validateFurnitureAttachment(buffer, item.classname);
			return {
				buffer,
				sourceId: source.id,
				sourceName: source.name,
				revision: item.revision,
			};
		} catch {
			/* Invalid, blocked or missing bundles never become local assets. */
		}
	}
	return null;
}

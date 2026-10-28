/**
 * Module-level cache for the song picker options, shared between the
 * catalog-items table (where the picker lives) and the Sounds admin page
 * (which invalidates after an upload/edit/delete).
 *
 * Living in `src/lib/` (outside any `[dynamic]` route folder) avoids
 * cross-route client imports that confused Turbopack's HMR boundaries
 * and triggered `Router action dispatched before initialization` on
 * the Sounds page in dev.
 */

export interface SoundtrackOption {
	id: number;
	code: string;
	name: string;
	author: string;
	length: number;
}

let cachedOptions: SoundtrackOption[] | null = null;
let inflight: Promise<SoundtrackOption[]> | null = null;

export async function loadSongPickerOptions(): Promise<SoundtrackOption[]> {
	if (cachedOptions) return cachedOptions;
	if (inflight) return inflight;
	inflight = (async () => {
		const res = await fetch("/cms_api/admin/sounds", { cache: "no-store" });
		if (!res.ok) throw new Error("Failed to load soundtracks");
		const json = (await res.json()) as {
			ok: boolean;
			items?: SoundtrackOption[];
		};
		cachedOptions = json.items ?? [];
		inflight = null;
		return cachedOptions;
	})();
	return inflight;
}

export function getCachedSongPickerOptions(): SoundtrackOption[] | null {
	return cachedOptions;
}

/** Clear the cache so new uploads show up on next open. */
export function invalidateSongPickerCache(): void {
	cachedOptions = null;
}

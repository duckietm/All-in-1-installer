import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { getPetIconPng } from "@/lib/services/pet-icon";

// Serves a cropped pet preview PNG extracted from the pet's .nitro spritesheet.
export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request) => {
		const lib = request.nextUrl.searchParams.get("lib") || "";
		const png = await getPetIconPng(lib);
		if (!png) return new Response(null, { status: 404 });
		return new Response(new Uint8Array(png), {
			headers: {
				"Content-Type": "image/png",
				// short cache so generator tweaks show up quickly; the in-process icon
				// cache keeps regeneration cheap. Client bumps a ?v= when output changes.
				"Cache-Control": "public, max-age=300",
			},
		});
	},
);

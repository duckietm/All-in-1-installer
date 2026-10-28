import { apiError, apiJson, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { validateClassnames } from "@/lib/furni/studio-inspection";
import { PERMS } from "@/lib/permission-slugs";
import { stageFurnitureAttachment } from "@/lib/services/furni-attachment";
export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT, maxBodyBytes: 52 * 1024 * 1024 },
	async (request, ctx) => {
		const form = await request.formData(),
			classname = form.get("classname"),
			file = form.get("file");
		if (
			typeof classname !== "string" ||
			!validateClassnames([classname]) ||
			!(file instanceof File) ||
			file.size === 0 ||
			file.size > 50 * 1024 * 1024
		)
			return apiError(
				"Select a .hab file for this furniture (maximum 50 MB)",
				400,
			);
		try {
			const attachmentId = await stageFurnitureAttachment(
				Buffer.from(await file.arrayBuffer()),
				classname,
				ctx.session.user.id,
			);
			return apiOk({ attachmentId });
		} catch (error) {
			return apiJson(
				{
					error: "Invalid original .hab file",
					code:
						error instanceof Error &&
						error.message.startsWith("This bundle does not belong")
							? "mismatchedFile"
							: "invalidFile",
				},
				{ status: 400 },
			);
		}
	},
);

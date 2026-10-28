"use server";

import { z } from "zod";
import { db, EmulatorSettings } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { actionOk } from "@/lib/safe-action-shared";
import { logAudit } from "@/lib/services/audit";
import { rcon } from "@/lib/services/rcon";

const saveEmulatorSettingsSchema = z.object({
	settings: z.record(z.string(), z.string()),
});

export const saveEmulatorSettings = adminAction(
	{ permission: PERMS.SETTINGS_EDIT, schema: saveEmulatorSettingsSchema },
	async (ctx) => {
		const entries = Object.entries(ctx.data.settings);

		for (const [key, value] of entries) {
			await db
				.insert(EmulatorSettings)
				.values({ key, value: String(value) })
				.onDuplicateKeyUpdate({ set: { value: String(value) } });
		}

		await rcon.updateConfig();

		logAudit({
			userId: ctx.session.user.id,
			action: "emulator_settings_update",
			target: "EmulatorSettings",
			after: ctx.data.settings,
		});

		return actionOk();
	},
);

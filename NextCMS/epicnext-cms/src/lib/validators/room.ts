import { z } from "zod";

export const updateRoomSchema = z.object({
	name: z.string().min(1).max(60).optional(),
	description: z.string().max(512).optional(),
	state: z.enum(["open", "locked", "password", "invisible"]).optional(),
	usersMax: z.number().int().min(1).max(100).optional(),
});

export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

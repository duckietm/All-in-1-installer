import { z } from "zod";
import { passwordPolicy } from "@/lib/auth/password-policy";

export const createUserSchema = z.object({
	username: z
		.string()
		.min(3, "Username must be at least 3 characters")
		.max(20, "Username must be at most 20 characters")
		.regex(
			/^[a-zA-Z0-9_-]+$/,
			"Username can only contain letters, numbers, _ and -",
		),
	mail: z.string().email("Invalid email address"),
	password: z
		.string()
		.min(
			passwordPolicy.minLength,
			`Password must be at least ${passwordPolicy.minLength} characters`,
		)
		.max(
			passwordPolicy.maxLength,
			`Password must be at most ${passwordPolicy.maxLength} characters`,
		),
	rank: z.coerce.number().int().min(1).max(7).default(1),
	motto: z.string().max(127).default(""),
});

export const updateUserSchema = z.object({
	username: z.string().min(3).max(20).optional(),
	mail: z.string().email().optional(),
	rank: z.number().int().min(1).max(7).optional(),
	motto: z.string().max(127).optional(),
	credits: z.number().int().min(0).max(2147483647).optional(),
	pixels: z.number().int().min(0).max(2147483647).optional(),
	diamonds: z.number().int().min(0).max(2147483647).optional(),
	duckets: z.number().int().min(0).max(2147483647).optional(),
});

export const banUserSchema = z.object({
	userId: z.coerce.number().int().positive(),
	reason: z.string().min(1, "Ban reason is required").max(500),
	duration: z.coerce.number().int().min(0, "Duration must be 0 or more hours"),
	type: z.enum(["account", "ip", "machine"]).default("account"),
	ip: z.string().optional(),
});

export const giveBadgeSchema = z.object({
	userId: z.coerce.number().int().positive(),
	badgeCode: z.string().min(1, "Badge code is required").max(20),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type BanUserInput = z.infer<typeof banUserSchema>;
export type GiveBadgeInput = z.infer<typeof giveBadgeSchema>;

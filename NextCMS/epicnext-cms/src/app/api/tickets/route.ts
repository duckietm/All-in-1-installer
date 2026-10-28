// Public REST API — help-center tickets (collection).
//
// Bearer-authed. GET lists the authed user's own tickets; POST opens a new one.
// Backed by website_help_center_tickets (WebsiteHelpCenterTickets). Fail-soft:
// DB errors return an apiError envelope, never a 500.

import { desc, eq } from "drizzle-orm";
import { apiError, apiJson, positiveBigInt } from "@/lib/api";
import { bearerUserId } from "@/lib/api-auth";
import { db, WebsiteHelpCenterTickets } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// GET /api/tickets — the authed user's tickets (newest first).
export async function GET(req: Request) {
	const uid = await bearerUserId(req, ["tickets:read"]);
	if (!uid) return apiError("Unauthorized", 401);

	try {
		const tickets = await db
			.select({
				id: WebsiteHelpCenterTickets.id,
				title: WebsiteHelpCenterTickets.title,
				open: WebsiteHelpCenterTickets.open,
				createdAt: WebsiteHelpCenterTickets.createdAt,
			})
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.userId, uid))
			.orderBy(desc(WebsiteHelpCenterTickets.id));

		return apiJson({
			tickets: tickets.map((t) => ({
				id: t.id,
				title: t.title,
				open: t.open,
				createdAt: t.createdAt,
			})),
		});
	} catch {
		return apiError("Failed to load tickets", 503);
	}
}

// POST /api/tickets — open a new ticket ({ title, content, categoryId? }).
export async function POST(req: Request) {
	const uid = await bearerUserId(req, ["tickets:write"]);
	if (!uid) return apiError("Unauthorized", 401);

	if (!(await rateLimit(`api-ticket:${uid}`, 5, 60_000)).ok) {
		return apiError("Too many requests", 429);
	}

	const body = (await req.json().catch(() => ({}))) as {
		title?: unknown;
		content?: unknown;
		categoryId?: unknown;
	};

	const title = String(body.title ?? "")
		.trim()
		.slice(0, 255);
	const content = String(body.content ?? "")
		.trim()
		.slice(0, 5000);
	if (!title) return apiError("Title is required");
	if (!content) return apiError("Content is required");

	// categoryId is an optional unsigned BigInt FK — accept a positive numeric
	// value, otherwise leave it null.
	let categoryId: bigint | null = null;
	if (
		body.categoryId !== undefined &&
		body.categoryId !== null &&
		body.categoryId !== ""
	) {
		categoryId = positiveBigInt(String(body.categoryId));
		if (!categoryId) return apiError("A valid category id is required", 422);
	}

	try {
		const now = new Date();
		const [result] = await db.insert(WebsiteHelpCenterTickets).values({
			userId: uid,
			categoryId,
			title,
			content,
			open: true,
			createdAt: now,
			updatedAt: now,
		});

		return apiJson(
			{
				ticket: {
					id: BigInt(result.insertId),
					title,
					open: true,
					createdAt: now,
				},
			},
			{ status: 201 },
		);
	} catch {
		return apiError("Failed to create ticket", 503);
	}
}

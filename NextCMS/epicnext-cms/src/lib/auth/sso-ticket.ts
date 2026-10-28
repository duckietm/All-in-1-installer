import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, User } from "@/lib/db";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Build the SSO ticket exactly like AtomCMS's User::ssoTicket():
 *   $hotelName = Str::replace(' ', '', setting('hotel_name'));
 *   sprintf('%s-%s', $hotelName, Str::uuid());
 * i.e. the hotel name with ALL whitespace removed, a dash, then a v4 UUID.
 * The emulator validates this exact value when the Nitro/Flash client connects.
 */
export function generateSsoTicket(hotelName: string): string {
	const normalized = hotelName.replace(/[\s]+/g, "");
	return `${normalized}-${randomUUID()}`;
}

/**
 * True when the ticket is exactly '{hotelName-no-spaces}-{v4 UUID}', i.e. the
 * shape the emulator accepts for this hotel. Anything else is treated as stale
 * and replaced with a fresh ticket.
 */
export function isValidTicketShape(hotelName: string, ticket: string): boolean {
	const normalized = hotelName.replace(/[\s]+/g, "");
	return (
		ticket.length > normalized.length + 1 &&
		ticket.startsWith(`${normalized}-`) &&
		UUID_RE.test(ticket.slice(normalized.length + 1))
	);
}

async function readTicket(userId: number): Promise<string | null> {
	const rows = await db
		.select({ authTicket: User.authTicket })
		.from(User)
		.where(eq(User.id, userId))
		.limit(1);
	return rows[0]?.authTicket ?? null;
}

/**
 * Generate a ticket and persist it like AtomCMS: writes auth_ticket AND
 * ip_current on the user, then returns the ticket for the client launcher.
 *
 * The outstanding ticket is REUSED instead of being regenerated on every page
 * load, so reloading /client or opening a second tab no longer invalidates a
 * game session that is still connecting. When a new ticket is minted, the
 * write is guarded against the previously-read value so concurrent launches
 * all receive the same ticket rather than clobbering each other.
 */
export async function issueSsoTicket(
	userId: number,
	hotelName: string,
	ip: string,
): Promise<string> {
	const current = await readTicket(userId);

	if (current && isValidTicketShape(hotelName, current)) {
		await db.update(User).set({ ipCurrent: ip }).where(eq(User.id, userId));
		return current;
	}

	const ticket = generateSsoTicket(hotelName);
	await db
		.update(User)
		.set({ authTicket: ticket, ipCurrent: ip })
		.where(and(eq(User.id, userId), eq(User.authTicket, current ?? "")));

	// Return whatever actually landed in the DB so every concurrent launcher
	// sends the exact same ticket to the emulator.
	const stored = await readTicket(userId);
	if (stored && isValidTicketShape(hotelName, stored)) return stored;
	return ticket;
}

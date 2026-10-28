import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSsoTicket, isValidTicketShape } from "./sso-ticket";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const VALID_UUID = "12345678-1234-4123-8123-123456789abc";

const readState = vi.hoisted(() => ({ authTicket: "" }));

const mockLimit = vi.hoisted(() => ({
	limit: () => Promise.resolve([{ authTicket: readState.authTicket }]),
}));
const mockWhere = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSet = vi.hoisted(() =>
	vi.fn((values: { authTicket?: string; ipCurrent?: string }) => {
		if (values.authTicket !== undefined)
			readState.authTicket = values.authTicket;
		return { where: mockWhere };
	}),
);
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockSet })));
const mockSelect = vi.hoisted(() =>
	vi.fn(() => ({ from: () => ({ where: () => mockLimit }) })),
);

vi.mock("@/lib/db", () => ({
	db: { select: mockSelect, update: mockUpdate },
	User: { id: "id" },
}));

describe("generateSsoTicket", () => {
	it("uses '{hotelName-without-spaces}-{uuidv4}'", () => {
		const t = generateSsoTicket("Atom Hotel");
		expect(t.startsWith("AtomHotel-")).toBe(true);
		expect(UUID_RE.test(t.slice("AtomHotel-".length))).toBe(true);
	});

	it("strips every whitespace char in the hotel name", () => {
		expect(
			generateSsoTicket("My\tCool\nHotel").startsWith("MyCoolHotel-"),
		).toBe(true);
	});

	it("produces a fresh ticket each call", () => {
		expect(generateSsoTicket("Atom")).not.toBe(generateSsoTicket("Atom"));
	});
});

describe("isValidTicketShape", () => {
	it("accepts a matching hotel-prefixed UUID", () => {
		expect(isValidTicketShape("Atom Hotel", `AtomHotel-${VALID_UUID}`)).toBe(
			true,
		);
	});

	it("rejects a ticket with a different hotel prefix", () => {
		expect(isValidTicketShape("Atom", `Other-${VALID_UUID}`)).toBe(false);
	});

	it("rejects junk", () => {
		expect(isValidTicketShape("Atom", "")).toBe(false);
		expect(isValidTicketShape("Atom", "Atom-not-a-uuid")).toBe(false);
		expect(isValidTicketShape("Atom", "Atom-")).toBe(false);
	});
});

describe("issueSsoTicket", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readState.authTicket = "";
		mockSet.mockImplementation(
			(values: { authTicket?: string; ipCurrent?: string }) => {
				if (values.authTicket !== undefined)
					readState.authTicket = values.authTicket;
				return { where: mockWhere };
			},
		);
		mockWhere.mockResolvedValue(undefined);
	});

	it("mints a ticket and writes auth_ticket + ip_current", async () => {
		const { issueSsoTicket } = await import("./sso-ticket");
		const ticket = await issueSsoTicket(42, "Atom Hotel", "1.2.3.4");
		expect(ticket.startsWith("AtomHotel-")).toBe(true);
		expect(UUID_RE.test(ticket.slice("AtomHotel-".length))).toBe(true);
		expect(mockUpdate).toHaveBeenCalled();
		expect(mockSet).toHaveBeenCalledWith({
			authTicket: ticket,
			ipCurrent: "1.2.3.4",
		});
		expect(mockWhere).toHaveBeenCalled();
	});

	it("reuses the outstanding ticket on the next call", async () => {
		const { issueSsoTicket } = await import("./sso-ticket");
		const first = await issueSsoTicket(42, "Atom Hotel", "1.1.1.1");
		vi.clearAllMocks();

		const second = await issueSsoTicket(42, "Atom Hotel", "2.2.2.2");
		expect(second).toBe(first);
	});

	it("only refreshes the IP when reusing", async () => {
		const { issueSsoTicket } = await import("./sso-ticket");
		await issueSsoTicket(42, "Atom Hotel", "1.1.1.1");
		vi.clearAllMocks();

		await issueSsoTicket(42, "Atom Hotel", "2.2.2.2");
		expect(mockSet).toHaveBeenCalledWith({ ipCurrent: "2.2.2.2" });
		expect(mockSet).not.toHaveBeenCalledWith(
			expect.objectContaining({ authTicket: expect.any(String) }),
		);
	});

	it("rotates a stale ticket whose prefix no longer matches the hotel", async () => {
		const { issueSsoTicket } = await import("./sso-ticket");
		readState.authTicket = `OtherHotel-${VALID_UUID}`;

		const ticket = await issueSsoTicket(42, "Atom Hotel", "1.1.1.1");
		expect(ticket.startsWith("AtomHotel-")).toBe(true);
		expect(readState.authTicket).toBe(ticket);
	});
});

// @ts-nocheck
import { describe, expect, it } from "vitest";
import { CurrencyType } from "./currency";
import { RconClient, type RconPayload } from "./rcon";

function spyClient() {
	const sent: RconPayload[] = [];
	const client = new RconClient(async (p) => {
		sent.push(p);
		return true;
	});
	return { client, sent };
}

describe("RconClient payloads (AtomCMS-faithful shapes)", () => {
	it("givecredits", async () => {
		const { client, sent } = spyClient();
		await client.giveCredits(7, 100);
		expect(sent[0]).toEqual({
			key: "givecredits",
			data: { user_id: 7, credits: 100 },
		});
	});

	it("givepoints carries the numeric currency type", async () => {
		const { client, sent } = spyClient();
		await client.giveDiamonds(7, 3);
		expect(sent[0]).toEqual({
			key: "givepoints",
			data: { user_id: 7, points: 3, type: CurrencyType.Diamonds },
		});
		expect(JSON.parse(JSON.stringify(sent[0])).data.type).toBe(5);
	});

	it("sendgift uses 'itemid' (not item_id)", async () => {
		const { client, sent } = spyClient();
		await client.sendGift(7, 42);
		expect(sent[0]).toEqual({
			key: "sendgift",
			data: { user_id: 7, itemid: 42, message: "Here is a gift." },
		});
	});

	it("disconnect carries username", async () => {
		const { client, sent } = spyClient();
		await client.disconnectUser(7, "alice");
		expect(sent[0]).toEqual({
			key: "disconnect",
			data: { user_id: 7, username: "alice" },
		});
	});

	it("no-data commands send data:null", async () => {
		const { client, sent } = spyClient();
		await client.updateWordFilter();
		await client.updateCatalog();
		expect(sent[0]).toEqual({ key: "updatewordfilter", data: null });
		expect(sent[1]).toEqual({ key: "updatecatalog", data: null });
	});

	it("setmotto / setrank / forwarduser / alertuser shapes", async () => {
		const { client, sent } = spyClient();
		await client.setMotto(1, "hi");
		await client.setRank(1, 7);
		await client.forwardUser(1, 99);
		await client.alertUser(1, "yo");
		expect(sent).toEqual([
			{ key: "setmotto", data: { user_id: 1, motto: "hi" } },
			{ key: "setrank", data: { user_id: 1, rank: 7 } },
			{ key: "forwarduser", data: { user_id: 1, room_id: 99 } },
			{ key: "alertuser", data: { user_id: 1, message: "yo" } },
		]);
	});
});

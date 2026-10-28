// @ts-nocheck
import { beforeEach, expect, it } from "vitest";
import { articleRequest } from "./article-request";

const values = new Map<string, string>();
const storage = {
	getItem: (key: string) => values.get(key) ?? null,
	setItem: (key: string, value: string) => {
		values.set(key, value);
	},
};
function form(body = "Private article body") {
	const form = new FormData();
	form.set("fullStory", body);
	form.set("status", "published");
	return form;
}
beforeEach(() => values.clear());
it("reuses the request after a lost response and an editor reload", async () => {
	const first = await articleRequest(form(), "staff:1:new", undefined, storage);
	const retry = await articleRequest(form(), "staff:1:new", undefined, storage);
	expect(retry.key).toBe(first.key);
	expect([...values.values()].join()).not.toContain("Private article body");
});
it("uses a new request for changed content or a different editor", async () => {
	const first = await articleRequest(form(), "staff:1:new", undefined, storage);
	expect(
		(await articleRequest(form("Changed"), "staff:1:new", first, storage)).key,
	).not.toBe(first.key);
	expect(
		(await articleRequest(form(), "staff:2:new", undefined, storage)).key,
	).not.toBe(first.key);
});
it("retains the in-memory request when browser storage is unavailable", async () => {
	const blocked = {
		getItem: () => {
			throw Error("blocked");
		},
		setItem: () => {
			throw Error("blocked");
		},
	};
	const first = await articleRequest(form(), "staff:1:new", undefined, blocked);
	expect(
		(await articleRequest(form(), "staff:1:new", first, blocked)).key,
	).toBe(first.key);
});

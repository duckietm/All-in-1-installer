import { expect, test } from "@playwright/test";
import {
	avatarPath,
	getThroughEdge,
	IMAGER_PATH,
	IS_EDGE,
	looksLikeImage,
} from "./imaging-target";

// Regression guard for the public topology: the edge proxy must front the
// imager container at `/imaging/*` while `/api/imaging/*` reaches the CMS.
// Mis-routing here blanks avatars for every visitor, and no unit test sees it.
// Only meaningful against the public origin, so it is skipped when the CMS is
// reached directly (set `IMAGING_EDGE=1` for the public origin).
test.skip(
	!IS_EDGE,
	"Public routing is only asserted against the edge-fronted origin",
);

test("the edge serves the imager endpoint as an image", async ({ request }) => {
	const response = await getThroughEdge(
		request,
		IMAGER_PATH({ img_format: "png" }),
	);
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/");
	expect(looksLikeImage(await response.body())).toBe(true);
});

test("the CMS avatar endpoint is reachable through the edge", async ({
	request,
}) => {
	const response = await getThroughEdge(
		request,
		avatarPath({ img_format: "png" }),
	);
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/");
	expect(looksLikeImage(await response.body())).toBe(true);
});

test("the edge does not shadow the CMS badge endpoint", async ({ request }) => {
	const response = await getThroughEdge(request, "/api/imaging/badge?code=ADM");
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/");
});

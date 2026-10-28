import { readFile } from "node:fs/promises";
import { type BrowserContext, expect, test } from "@playwright/test";
import Redis from "ioredis";
import mysql, {
	type ConnectionOptions,
	type RowDataPacket,
} from "mysql2/promise";

interface Fixture {
	username: string;
	userId: number;
	password: string;
	database: ConnectionOptions;
	redis: { host: string; port: number; password: string };
}

async function onlyLocalResources(context: BrowserContext, origin: string) {
	// External avatars/telemetry are outside this isolated hotel. All application
	// documents, scripts, forms, API requests and auth responses remain untouched.
	await context.route("**/*", (route) => {
		if (new URL(route.request().url()).origin === origin)
			return route.continue();
		return route.abort("blockedbyclient");
	});
}

test("staff signs in, saves a draft, previews it and publishes to anonymous readers", async ({
	page,
	context,
	browser,
	baseURL,
}, testInfo) => {
	if (!baseURL || !process.env.NEWS_E2E_FIXTURE)
		throw Error("Disposable fixture is required");
	const fixture = JSON.parse(
		await readFile(process.env.NEWS_E2E_FIXTURE, "utf8"),
	) as Fixture;
	const database = await mysql.createConnection({
		...fixture.database,
		timezone: "Z",
		charset: "utf8mb4",
		supportBigNumbers: true,
		bigNumberStrings: true,
	});
	const redis = new Redis({
		...fixture.redis,
		maxRetriesPerRequest: 1,
		connectTimeout: 5_000,
	});
	const anonymous = await browser.newContext({
		baseURL,
		locale: "en-US",
		ignoreHTTPSErrors: true,
	});
	const reader = await anonymous.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	reader.on("pageerror", (error) => errors.push(error.message));
	const rows = async (sql: string, params: string[] = []) =>
		(await database.query<RowDataPacket[]>(sql, params))[0];
	const title = "Notizia browser: città e novità 🎉";
	const publicTitle = reader.locator(
		".content-card:has(.article-body) .content-card-title",
	);
	const slug = "browser-news-real";
	const summary =
		"Una notizia creata e pubblicata attraverso il pannello reale.";
	const body = "È una prova reale: caffè, città e 🎉. Salvata dal browser.";
	let articleId = "";
	let submittedHtml = "";
	let draftRevision: string | null = null;
	try {
		await onlyLocalResources(context, baseURL);
		await onlyLocalResources(anonymous, baseURL);
		await redis.ping();
		await test.step("real authentication and staff ACL", async () => {
			await page.goto("/admin/articles/new");
			await expect(page).toHaveURL(/\/login(?:\?|$)/);
			expect(await rows("SELECT user_id FROM website_login_logs")).toHaveLength(
				0,
			);
			await page
				.locator('input[autocomplete="username"]')
				.fill(fixture.username);
			await page
				.locator('input[autocomplete="current-password"]')
				.fill(fixture.password);
			await page
				.locator('input[autocomplete="current-password"]')
				.press("Enter");
			// The login page honours `?from=`, so an admin bounced off /admin lands
			// back where they were heading instead of on /me. The step below
			// navigates there explicitly anyway; this asserts the redirect target.
			await expect(page).toHaveURL(/\/admin\/articles\/new(?:\?|$)/);
			const session = await context.request
				.get("/api/auth/session")
				.then((response) => response.json());
			expect(session.user).toMatchObject({
				id: String(fixture.userId),
				name: fixture.username,
				rank: 7,
			});
			expect(
				(await context.cookies()).some(
					(cookie) =>
						cookie.name.startsWith("__Secure-authjs.session-token") &&
						cookie.secure &&
						cookie.httpOnly,
				),
			).toBe(true);
			expect(await rows("SELECT user_id FROM website_login_logs")).toEqual([
				expect.objectContaining({ user_id: fixture.userId }),
			]);
			// The editor is below the highest occupied rank: access requires real ACL grants.
			expect(
				(await rows("SELECT MAX(rank) AS highest FROM users"))[0].highest,
			).toBe(9);
			await page.goto("/admin/articles/new");
			await expect(page.locator('input[name="title"]')).toBeVisible();
		});
		await test.step("save the draft using the real rich text editor and server action", async () => {
			const form = page.locator('form:has(input[name="title"])');
			await form.locator('input[name="title"]').fill(title);
			await form.locator('input[name="slug"]').fill(slug);
			await form.locator('[name="shortStory"]').fill(summary);
			await form
				.locator('input[name="image"]')
				.fill("/assets/images/EnterHubbly.png");
			await form.locator('select[name="status"]').selectOption("draft");
			const editor = form
				.frameLocator("iframe.tox-edit-area__iframe")
				.locator('body[contenteditable="true"]');
			await expect(editor).toBeVisible();
			await editor.fill(body);
			await editor.press("End");
			await expect(form.locator('textarea[name="fullStory"]')).toHaveValue(
				/Salvata dal browser/,
			);
			submittedHtml = await form
				.locator('textarea[name="fullStory"]')
				.inputValue();
			await form.locator('button[type="submit"]').click();
			await expect(page).toHaveURL(`${baseURL}/admin/articles`);
			const articles = await rows("SELECT * FROM website_articles");
			expect(articles).toHaveLength(1);
			expect(articles[0]).toMatchObject({
				title,
				slug,
				short_story: summary,
				status: "draft",
				user_id: fixture.userId,
				published_at: null,
				publish_at: null,
			});
			expect(articles[0].full_story).toBe(submittedHtml);
			articleId = String(articles[0].id);
			expect(await rows("SELECT kind, actor_id FROM cms_operations")).toEqual([
				expect.objectContaining({
					kind: "news.create",
					actor_id: fixture.userId,
				}),
			]);
		});
		await test.step("anonymous readers and the shared cache still see no published article", async () => {
			const response = await reader.goto(`/news/${slug}`);
			expect(response?.status()).toBeLessThan(500);
			// Next can stream not-found markup with HTTP 200; assert the actual 404 screen.
			await expect(reader.locator(".error-screen-code")).toHaveText("404");
			await expect(publicTitle).toHaveCount(0);
			const listing = await anonymous.request
				.get("/api/articles")
				.then((response) => response.json());
			expect(listing.data).toEqual([]);
			expect(listing.meta.total).toBe(0);
			draftRevision = await redis.get("cms:news:revision");
			expect(draftRevision).not.toBeNull();
			expect(
				await redis.get(`news:${draftRevision}:article:v2:slug:${slug}`),
			).toBe("null");
		});
		await test.step("preview the persisted draft without publishing it", async () => {
			await page
				.locator(`a[href="/admin/articles/${articleId}"]`)
				.first()
				.click();
			const form = page.locator('form:has(input[name="title"])');
			await expect(form.locator('input[name="title"]')).toHaveValue(title);
			await expect(form.locator('select[name="status"]')).toHaveValue("draft");
			await expect(
				form.frameLocator("iframe.tox-edit-area__iframe").locator("body"),
			).toContainText(body);
			await form.getByRole("button", { name: "Preview", exact: true }).click();
			const preview = page.getByRole("dialog").frameLocator("iframe");
			await expect(
				preview.getByRole("heading", { name: title, exact: true }),
			).toBeVisible();
			await expect(preview.locator("body")).toContainText(summary);
			await expect(preview.locator("body")).toContainText(body);
			expect(await rows("SELECT status FROM website_articles")).toEqual([
				{ status: "draft" },
			]);
			expect(
				await rows("SELECT id FROM website_article_revisions"),
			).toHaveLength(0);
			// Preview autofocus enters its sandboxed iframe, whose Escape event cannot reach the dialog.
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Close", exact: true })
				.click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
		});
		await test.step("publish once and persist revision, audit and delivery intent", async () => {
			const form = page.locator('form:has(input[name="title"])');
			await form.locator('select[name="status"]').selectOption("published");
			await form.locator('button[type="submit"]').click();
			await expect(page).toHaveURL(`${baseURL}/admin/articles`);
			const articles = await rows("SELECT * FROM website_articles");
			expect(articles).toHaveLength(1);
			expect(articles[0]).toMatchObject({
				status: "published",
				user_id: fixture.userId,
				slug,
				title,
			});
			expect(articles[0].published_at).toBeInstanceOf(Date);
			const revisions = await rows(
				"SELECT article_id, user_id, payload FROM website_article_revisions",
			);
			expect(revisions).toHaveLength(1);
			expect(String(revisions[0].article_id)).toBe(articleId);
			expect(Number(revisions[0].user_id)).toBe(fixture.userId);
			expect(JSON.parse(revisions[0].payload)).toMatchObject({
				title,
				status: "draft",
			});
			const audit = await rows(
				"SELECT user_id, `before`, `after` FROM admin_audit_log WHERE target='news'",
			);
			expect(audit).toHaveLength(1);
			expect(audit[0].user_id).toBe(fixture.userId);
			expect(JSON.parse(audit[0].before).status).toBe("draft");
			expect(JSON.parse(audit[0].after).status).toBe("published");
			const operations = await rows(
				"SELECT kind, actor_id, result_json FROM cms_operations ORDER BY kind",
			);
			expect(operations.map((operation) => operation.kind)).toEqual([
				"news.create",
				"news.update",
			]);
			for (const operation of operations) {
				expect(operation.actor_id).toBe(fixture.userId);
				expect(JSON.parse(operation.result_json)).toMatchObject({ ok: true });
			}
			const effects = await rows("SELECT topic FROM cms_outbox");
			expect(effects).toEqual([
				{ topic: "news.refresh" },
				{ topic: "news.refresh" },
			]);
			expect(await redis.get("cms:news:revision")).not.toBe(draftRevision);
		});
		await test.step("anonymous pages and API read the newly published content", async () => {
			const response = await reader.reload();
			expect(response?.status()).toBe(200);
			await expect(publicTitle).toHaveText(title);
			await expect(publicTitle).toBeVisible();
			await expect(reader.locator(".article-body")).toContainText(body);
			await expect(reader.locator(".error-screen-code")).toHaveCount(0);
			const listing = await anonymous.request
				.get("/api/articles")
				.then((response) => response.json());
			expect(listing.data).toHaveLength(1);
			expect(listing.data[0]).toMatchObject({
				id: articleId,
				title,
				slug,
				shortStory: summary,
			});
			expect(listing.meta.total).toBe(1);
			const revision = await redis.get("cms:news:revision");
			const cached = await redis.get(
				`news:${revision}:article:v2:slug:${slug}`,
			);
			expect(JSON.parse(cached ?? "null")).toMatchObject({
				id: articleId,
				title,
				slug,
			});
			expect(
				(await anonymous.cookies()).some((cookie) =>
					cookie.name.includes("session-token"),
				),
			).toBe(false);
			expect(errors).toEqual([]);
		});
	} finally {
		if (errors.length)
			await testInfo.attach("browser-errors", {
				body: JSON.stringify(errors, null, 2),
				contentType: "application/json",
			});
		await anonymous.close().catch(() => {});
		await database.end();
		redis.disconnect();
	}
});

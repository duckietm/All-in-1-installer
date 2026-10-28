import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
import mysql from "mysql2/promise";
import {
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from "testcontainers";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { WebsiteArticles } from "@/db/schema";
import { articleEditToken } from "@/lib/article-edit-token";

// Only request/framework boundaries are replaced; persistence, caches and workers are real.
const boundaries = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/lib/admin/guard", () => ({
	requirePermission: async () => ({ id: 7, username: "Integration editor" }),
}));
// Permission constants stay real without loading the session/ACL runtime.
vi.mock("@/lib/permissions", () => import("@/lib/permission-slugs"));
vi.mock("next-intl/server", () => ({
	getTranslations: async () => (key: string) => key,
}));
// The data cache only exists inside a Next render, so both entry points degrade
// to the real work underneath them instead of being stubbed out.
vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
	unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({
	redirect: (url: string) => {
		throw Error(`Unexpected integration redirect: ${url}`);
	},
}));
vi.mock("@/lib/services/webhook", () => ({ notify: boundaries.notify }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "7" } }) }));
vi.mock("@/lib/api-auth", () => ({ bearerUserId: async () => 7 }));

const exec = promisify(execFile);
const NEWS_REVISION_KEY = "cms:news:revision";
const migrations = [
	"0025_article_publication.sql",
	"0026_article_editor_recovery.sql",
	"0027_catalog_packages.sql",
	"0028_history_snapshots.sql",
	"0029_admin_table_views.sql",
	"0031_operations_outbox.sql",
];
let maria: StartedTestContainer | undefined;
let redisContainer: StartedTestContainer | undefined;
let connection: mysql.Connection | undefined;
let appDb: typeof import("@/lib/db").db | undefined;
let appRedis: typeof import("@/lib/redis").redis;
let commands: typeof import("@/features/catalog/server/bulk-offers");
let operations: typeof import("@/features/operations/server");
let cache: typeof import("@/lib/cache");
let articles: typeof import("@/actions/admin-articles");
let publicNews: typeof import("@/lib/services/news-detail");
let commentSubmission: typeof import("@/lib/services/article-comment-submission");
let commentModeration: typeof import("@/lib/services/moderation");
let commentAction: typeof import("@/actions/article-comments");
let commentApi: typeof import("@/app/api/articles/[slug]/comment/route");
let scheduler: typeof import("@/lib/services/news-scheduler");
let worker: typeof import("@/features/operations/worker");
let migrationRoot: string | undefined;
let databaseUrl: string;

async function rows(query: string) {
	if (!connection) throw Error("Integration database is not connected");
	const [result] = await connection.query<RowDataPacket[]>(query);
	return result;
}

async function migrate(...args: string[]) {
	if (!migrationRoot) throw Error("Migration fixture is not ready");
	// Only explicit test variables: the copied loader cannot see checkout .env files.
	return exec(
		process.execPath,
		[
			"--import",
			pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
			join(migrationRoot, "scripts/apply-migrations.ts"),
			...args,
		],
		{
			cwd: migrationRoot,
			env: {
				PATH: process.env.PATH,
				SystemRoot: process.env.SystemRoot,
				DATABASE_URL: databaseUrl,
				NODE_ENV: "test",
			},
			timeout: 30_000,
		},
	);
}

beforeAll(async () => {
	// No fixed names, ports, external URLs, shared volumes or container reuse.
	const databasePassword = randomUUID();
	const redisPassword = randomUUID();
	maria = await new GenericContainer("mariadb:11.4.5")
		.withEnvironment({
			MARIADB_ROOT_PASSWORD: randomUUID(),
			MARIADB_DATABASE: "integration",
			MARIADB_USER: "integration",
			MARIADB_PASSWORD: databasePassword,
		})
		.withExposedPorts(3306)
		.withHealthCheck({
			test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"],
			interval: 1000,
			timeout: 5000,
			retries: 60,
			startPeriod: 1000,
		})
		.withWaitStrategy(Wait.forHealthCheck())
		.withStartupTimeout(120_000)
		.start();
	databaseUrl = `mysql://integration:${databasePassword}@${maria.getHost()}:${maria.getMappedPort(3306)}/integration`;
	// Inspect stored TIMESTAMP values as UTC independently of the host timezone.
	// The application pool retains its production configuration.
	connection = await mysql.createConnection({
		host: maria.getHost(),
		port: maria.getMappedPort(3306),
		user: "integration",
		password: databasePassword,
		database: "integration",
		timezone: "Z",
		supportBigNumbers: true,
		bigNumberStrings: true,
		charset: "utf8mb4",
	});
	redisContainer = await new GenericContainer("redis:7.4.2-alpine")
		.withCommand(["redis-server", "--requirepass", redisPassword])
		.withExposedPorts(6379)
		.withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
		.withStartupTimeout(60_000)
		.start();
	process.env.DATABASE_URL = databaseUrl;
	process.env.REDIS_URL = `redis://:${redisPassword}@${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}/0`;
	delete process.env.SKIP_ENV_VALIDATION;
	delete process.env.OPENAI_API_KEY;
	// Deliberately NOT "test": cache.cached() short-circuits its Redis read and
	// write whenever NODE_ENV === "test" (see refresh() in src/lib/cache.ts).
	// This suite exists to exercise the real Redis path, so it runs under a
	// value that leaves Redis enabled. "development" is used because it is the
	// only non-production value src/env.ts accepts. Vitest's own environment is
	// still configured via vitest.integration.config.ts. Object.assign is used
	// because process.env.NODE_ENV is typed read-only.
	Object.assign(process.env, { NODE_ENV: "development" });
	process.env.HOTEL_NAME = "Integration";

	await connection.query(
		"CREATE TABLE catalog_pages (id INT PRIMARY KEY, caption VARCHAR(255) NOT NULL) ENGINE=InnoDB",
	);
	await connection.query(
		"CREATE TABLE catalog_items (id INT PRIMARY KEY, catalog_name VARCHAR(255) NOT NULL, page_id VARCHAR(25) NOT NULL, cost_credits INT NOT NULL, cost_points INT NOT NULL, points_type INT NOT NULL) ENGINE=InnoDB",
	);
	await connection.query(
		"CREATE TABLE admin_audit_log (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, action VARCHAR(191) NOT NULL DEFAULT '', target VARCHAR(191) NOT NULL DEFAULT '', target_id INT NULL, details TEXT NULL, `before` TEXT NULL, `after` TEXT NULL, diff TEXT NULL, ip_address VARCHAR(45) NULL, created_at VARCHAR(64) NOT NULL DEFAULT '', updated_at VARCHAR(64) NULL) ENGINE=InnoDB",
	);
	await connection.query(
		"CREATE TABLE website_articles (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(255) NOT NULL UNIQUE, title VARCHAR(255) NOT NULL, short_story VARCHAR(255) NOT NULL, full_story LONGTEXT NOT NULL, user_id INT NULL, image VARCHAR(255) NOT NULL, created_at TIMESTAMP NULL DEFAULT NULL, updated_at TIMESTAMP NULL DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
	);
	await connection.query(
		"CREATE TABLE website_article_comments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, article_id BIGINT UNSIGNED NOT NULL, user_id INT NOT NULL, comment VARCHAR(255) NOT NULL, created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
	);
	await connection.query(
		"CREATE TABLE website_wordfilter (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, word VARCHAR(255) NOT NULL UNIQUE, created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
	);
	// The emulator owns core tables. Exercise the real CMS migration CLI over this baseline.
	migrationRoot = await mkdtemp(join(resolve("integration"), ".migration-"));
	await mkdir(join(migrationRoot, "scripts"));
	await mkdir(join(migrationRoot, "drizzle/migrations"), { recursive: true });
	for (const file of [
		"apply-migrations.ts",
		"load-env.ts",
		"db-url.ts",
		"sql-statements.ts",
	]) {
		await copyFile(
			resolve("scripts", file),
			join(migrationRoot, "scripts", file),
		);
	}
	for (const file of migrations)
		await copyFile(
			resolve("drizzle/migrations", file),
			join(migrationRoot, "drizzle/migrations", file),
		);
	await migrate();
	appDb = (await import("@/lib/db")).db;
	appRedis = (await import("@/lib/redis")).redis;
	if (!appRedis) throw Error("Redis must be enabled in integration tests");
	await appRedis.ping();
	commands = await import("@/features/catalog/server/bulk-offers");
	cache = await import("@/lib/cache");
	operations = await import("@/features/operations/server");
	articles = await import("@/actions/admin-articles");
	publicNews = await import("@/lib/services/news-detail");
	commentSubmission = await import("@/lib/services/article-comment-submission");
	commentModeration = await import("@/lib/services/moderation");
	commentAction = await import("@/actions/article-comments");
	commentApi = await import("@/app/api/articles/[slug]/comment/route");
	scheduler = await import("@/lib/services/news-scheduler");
	worker = await import("@/features/operations/worker");
});

afterAll(async () => {
	// Settle every cleanup so a failed setup or close cannot leak the other container.
	const cleanup = await Promise.allSettled([
		appDb?.$client.end(),
		appRedis?.quit(),
		connection?.end(),
	]);
	const stops = await Promise.allSettled([
		maria?.stop(),
		redisContainer?.stop(),
	]);
	if (migrationRoot) {
		const target = resolve(migrationRoot);
		if (
			!target.startsWith(`${resolve("integration")}\\.migration-`) &&
			!target.startsWith(`${resolve("integration")}/.migration-`)
		)
			throw Error("Unsafe migration fixture path");
		await rm(target, { recursive: true, force: true });
	}
	for (const result of [...cleanup, ...stops])
		if (result.status === "rejected") throw result.reason;
});

beforeEach(async () => {
	if (!connection) throw Error("Integration database is not connected");
	vi.clearAllMocks();
	await appRedis?.set(NEWS_REVISION_KEY, randomUUID());
	await connection.query("DROP TRIGGER IF EXISTS reject_news_effect");
	await connection.query(
		"DROP TRIGGER IF EXISTS reject_second_scheduled_effect",
	);
	await connection.query("DELETE FROM website_article_revisions");
	await connection.query("DELETE FROM website_article_drafts");
	await connection.query("DELETE FROM website_article_comments");
	await connection.query("DELETE FROM website_wordfilter");
	commentModeration.reloadWordFilter();
	await appRedis?.del(
		"ratelimit:comment:7",
		"ratelimit:comment:8",
		"ratelimit:comment:9",
	);
	await connection.query("DELETE FROM website_articles");
	await connection.query("DELETE FROM cms_outbox");
	await connection.query("DELETE FROM cms_operations");
	await connection.query("DROP TRIGGER IF EXISTS reject_second_history");
	await connection.query("DELETE FROM admin_audit_log");
	await connection.query("DELETE FROM catalog_items");
	await connection.query("DELETE FROM catalog_pages");
	await connection.query(
		"INSERT INTO catalog_pages VALUES (1, 'Original'), (2, 'Destination')",
	);
	await connection.query(
		"INSERT INTO catalog_items VALUES (1, 'Chair', '1', 10, 0, 0), (2, 'Table', '1', 20, 0, 0)",
	);
});

const input = {
	ids: [1, 2],
	changes: { costCredits: { mode: "add" as const, value: 5 } },
};

describe("MariaDB migrations and catalog transactions", () => {
	it("runs the actual migration CLI twice without duplicate tracking or lost data", async () => {
		const before = await rows("SELECT * FROM cms_migrations ORDER BY id");
		expect(before.map((row) => row.migration)).toEqual(
			migrations.map((file) => file.replace(/\.sql$/, "")),
		);
		await connection?.query(
			"INSERT INTO website_admin_table_views VALUES (1, '/admin/catalog', 'Saved', '{}')",
		);
		expect((await migrate()).stdout).toContain(
			"All migrations already applied",
		);
		expect(await rows("SELECT * FROM cms_migrations ORDER BY id")).toEqual(
			before,
		);
		expect(await rows("SELECT name FROM website_admin_table_views")).toEqual([
			{ name: "Saved" },
		]);
		expect((await migrate("--status")).stdout).toContain(
			`${migrations.length}/${migrations.length} applied, 0 pending`,
		);
		const columns = await rows(
			"SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_audit_log' AND COLUMN_NAME IN ('before','after') ORDER BY COLUMN_NAME",
		);
		expect(columns.map((row) => row.DATA_TYPE)).toEqual([
			"mediumtext",
			"mediumtext",
		]);
	});

	it("commits both offers and history, then restores them through the real undo command", async () => {
		const preview = await commands.previewBulkOffersCommand(input);
		const result = await commands.applyBulkOffersCommand(
			input,
			preview.fingerprint,
			7,
		);
		expect(result.changedCount).toBe(2);
		expect(result.historyIds).toHaveLength(2);
		expect(
			(await rows("SELECT cost_credits FROM catalog_items ORDER BY id")).map(
				(row) => row.cost_credits,
			),
		).toEqual([15, 25]);
		expect(
			await rows("SELECT target, action FROM admin_audit_log ORDER BY id"),
		).toEqual([
			{ target: "catalog_offer", action: "history_update" },
			{ target: "catalog_offer", action: "history_update" },
		]);
		await commands.undoBulkOffersCommand(result.historyIds, 7);
		expect(
			(await rows("SELECT cost_credits FROM catalog_items ORDER BY id")).map(
				(row) => row.cost_credits,
			),
		).toEqual([10, 20]);
		expect(await rows("SELECT id FROM admin_audit_log")).toHaveLength(4);
	});

	it("rolls back earlier offer updates and history when the second history insert fails", async () => {
		await connection?.query(
			"CREATE TRIGGER reject_second_history BEFORE INSERT ON admin_audit_log FOR EACH ROW BEGIN IF NEW.target_id=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced history failure'; END IF; END",
		);
		const preview = await commands.previewBulkOffersCommand(input);
		await expect(
			commands.applyBulkOffersCommand(input, preview.fingerprint, 7),
		).rejects.toThrow();
		expect(
			(await rows("SELECT cost_credits FROM catalog_items ORDER BY id")).map(
				(row) => row.cost_credits,
			),
		).toEqual([10, 20]);
		expect(await rows("SELECT id FROM admin_audit_log")).toHaveLength(0);
	});

	it("serializes competing applications of one preview and rejects the stale contender", async () => {
		const preview = await commands.previewBulkOffersCommand(input);
		const results = await Promise.allSettled([
			commands.applyBulkOffersCommand(input, preview.fingerprint, 7),
			commands.applyBulkOffersCommand(input, preview.fingerprint, 8),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(rejected?.status === "rejected" && rejected.reason.message).toMatch(
			/selection.*changed|preview/i,
		);
		expect(
			(await rows("SELECT cost_credits FROM catalog_items ORDER BY id")).map(
				(row) => row.cost_credits,
			),
		).toEqual([15, 25]);
		expect(await rows("SELECT id FROM admin_audit_log")).toHaveLength(2);
	});
});

describe("Redis application cache", () => {
	it("writes to real Redis with expiry and reads it after memory invalidation", async () => {
		const key = `integration:${randomUUID()}:catalog`;
		let fetches = 0;
		const fetch = async () => ({ revision: ++fetches });
		expect(await cache.cached(key, 60_000, fetch)).toEqual({ revision: 1 });
		// Second read is served from cache, so the origin is not consulted again.
		expect(await cache.cached(key, 60_000, fetch)).toEqual({ revision: 1 });
		expect(await appRedis?.ttl(key)).toBeGreaterThan(0);
		cache.invalidateMemory(key);
		expect(await cache.cached(key, 60_000, fetch)).toEqual({ revision: 1 });
		expect(fetches).toBe(1);
		await appRedis?.del(key);
		cache.invalidateMemory(key);
		expect(await cache.cached(key, 60_000, fetch)).toEqual({ revision: 2 });
	});

	it("keeps two independently named cache entries isolated during invalidation", async () => {
		const first = `integration:${randomUUID()}:first`;
		const second = `integration:${randomUUID()}:second`;
		await cache.cached(first, 60_000, async () => "first");
		await cache.cached(second, 60_000, async () => "second");
		await appRedis?.del(first);
		cache.invalidateMemory(first);
		cache.invalidateMemory(second);
		expect(await cache.cached(first, 60_000, async () => "updated")).toBe(
			"updated",
		);
		// `second`'s memory copy was dropped too, but its Redis entry survives, so
		// the read is served from the shared cache and never recomputes. This is
		// what makes the two entries independent.
		expect(await cache.cached(second, 60_000, async () => "wrong")).toBe(
			"second",
		);
		expect(await appRedis?.get(second)).toBe('"second"');
	});
});

describe("operation idempotency and transactional outbox", () => {
	it("replays concurrent identical requests after applying their mutation and effect only once", async () => {
		const request = {
			actorId: 7,
			kind: "integration.test",
			key: randomUUID(),
			input: { increment: 3 },
		};
		let executions = 0;
		const work = async (
			tx: import("@/features/operations/server").OperationTransaction,
			id: string,
		) => {
			executions++;
			await tx.execute(
				sql`UPDATE catalog_items SET cost_credits=cost_credits+3 WHERE id=1`,
			);
			await operations.enqueueEffect(tx, id, "catalog.refresh");
			return { operationId: id, changed: 1 };
		};
		const result = await Promise.all([
			operations.runOperation(request, work),
			operations.runOperation(request, work),
		]);
		expect(result[0]).toEqual(result[1]);
		expect(executions).toBe(1);
		expect(
			await rows("SELECT cost_credits FROM catalog_items WHERE id=1"),
		).toEqual([{ cost_credits: 13 }]);
		expect(await rows("SELECT id FROM cms_operations")).toHaveLength(1);
		expect(await rows("SELECT topic,status FROM cms_outbox")).toEqual([
			{ topic: "catalog.refresh", status: "pending" },
		]);
		await expect(
			operations.runOperation({ ...request, input: { increment: 9 } }, work),
		).rejects.toThrow();
		expect(executions).toBe(1);
		expect(
			await rows("SELECT cost_credits FROM catalog_items WHERE id=1"),
		).toEqual([{ cost_credits: 13 }]);
	});

	it("rolls back the request, mutation and queued effect together, allowing the same request to retry", async () => {
		const request = {
			actorId: 7,
			kind: "integration.test",
			key: randomUUID(),
			input: { increment: 3 },
		};
		await expect(
			operations.runOperation(request, async (tx, id) => {
				await tx.execute(
					sql`UPDATE catalog_items SET cost_credits=99 WHERE id=1`,
				);
				await operations.enqueueEffect(tx, id, "catalog.refresh");
				throw Error("failure after effect enqueue");
			}),
		).rejects.toThrow("failure after effect enqueue");
		expect(
			await rows("SELECT cost_credits FROM catalog_items WHERE id=1"),
		).toEqual([{ cost_credits: 10 }]);
		expect(await rows("SELECT id FROM cms_operations")).toHaveLength(0);
		expect(await rows("SELECT id FROM cms_outbox")).toHaveLength(0);
		await expect(
			operations.runOperation(request, async (tx, id) => {
				await tx.execute(
					sql`UPDATE catalog_items SET cost_credits=13 WHERE id=1`,
				);
				await operations.enqueueEffect(tx, id, "catalog.refresh");
				return { changed: 1 };
			}),
		).resolves.toEqual({ changed: 1 });
		expect(
			await rows("SELECT cost_credits FROM catalog_items WHERE id=1"),
		).toEqual([{ cost_credits: 13 }]);
		expect(await rows("SELECT id FROM cms_outbox")).toHaveLength(1);
	});

	it("leases a queued effect to only one consumer and ignores a stale completion token", async () => {
		await operations.runOperation(
			{ actorId: 7, kind: "integration.test", key: randomUUID(), input: {} },
			async (tx, id) => {
				await operations.enqueueEffect(tx, id, "catalog.refresh");
				return { queued: true };
			},
		);
		const claims = await Promise.all([
			operations.effectRepository.claim(),
			operations.effectRepository.claim(),
		]);
		expect(claims.filter(Boolean)).toHaveLength(1);
		const claim = claims.find((value) => value !== null);
		if (!claim) throw Error("Expected one effect lease");
		await operations.effectRepository.complete({
			...claim,
			token: randomUUID(),
		});
		expect(await rows("SELECT status FROM cms_outbox")).toEqual([
			{ status: "running" },
		]);
		await operations.effectRepository.complete(claim);
		expect(await rows("SELECT status FROM cms_outbox")).toEqual([
			{ status: "done" },
		]);
	});
});

function articleForm(extra: Record<string, string> = {}) {
	const form = new FormData();
	for (const [key, value] of Object.entries({
		requestKey: randomUUID(),
		title: "Integration news",
		slug: "integration-news",
		shortStory: "A real database publication",
		fullStory: "<p>Original draft body</p>",
		image: "/images/news.png",
		status: "draft",
		...extra,
	}))
		form.set(key, value);
	return form;
}

async function savedArticle(slug = "integration-news") {
	if (!appDb) throw Error("Integration database is not connected");
	const [article] = await appDb
		.select()
		.from(WebsiteArticles)
		.where(eq(WebsiteArticles.slug, slug))
		.limit(1);
	if (!article) throw Error(`Missing article fixture: ${slug}`);
	return article;
}

async function seedScheduledArticles(now: Date) {
	if (!appDb) throw Error("Integration database is not connected");
	const before = new Date(now.getTime() - 60_000);
	const after = new Date(now.getTime() + 60_000);
	await appDb.insert(WebsiteArticles).values(
		[
			{
				id: 1n,
				slug: "due-earlier",
				status: "scheduled",
				publishAt: before,
				userId: 7,
			},
			{
				id: 9007199254740993n,
				slug: "due-now",
				status: "scheduled",
				publishAt: now,
				userId: null,
			},
			{
				id: 3n,
				slug: "future",
				status: "scheduled",
				publishAt: after,
				userId: 7,
			},
			{ id: 4n, slug: "draft", status: "draft", publishAt: before, userId: 7 },
			{
				id: 5n,
				slug: "already-public",
				status: "published",
				publishAt: before,
				userId: 7,
			},
		].map((article) => ({
			...article,
			title: article.slug,
			shortStory: "Scheduled integration fixture",
			fullStory: `<p>${article.slug}</p>`,
			image: "",
			createdAt: before,
			updatedAt: before,
			publishedAt: article.status === "published" ? before : null,
		})),
	);
}

describe("real news publication, scheduling and cache delivery", () => {
	it("creates one draft and publishes once under duplicate submits, preserving revision, audit and public content", async () => {
		const draft = articleForm();
		const created = await Promise.all([
			articles.createArticle(draft),
			articles.createArticle(draft),
		]);
		expect(created[0]).toMatchObject({ ok: true });
		expect(created[1]).toEqual(created[0]);
		expect(await rows("SELECT id FROM website_articles")).toHaveLength(1);
		expect(await rows("SELECT kind FROM cms_operations")).toEqual([
			{ kind: "news.create" },
		]);
		expect(await rows("SELECT id FROM website_article_revisions")).toHaveLength(
			0,
		);
		expect(boundaries.notify).not.toHaveBeenCalled();
		const existing = await savedArticle();
		const [creation] = await rows(
			"SELECT result_json FROM cms_operations WHERE kind='news.create'",
		);
		expect(JSON.parse(creation.result_json)).toMatchObject({
			articleId: String(existing.id),
			articleTitle: existing.title,
		});
		expect(existing.status).toBe("draft");
		expect(existing.publishedAt).toBeNull();
		expect(await publicNews.getPublishedArticle(existing.slug)).toBeNull();
		// A draft has no public article, so this read is a negative result that
		// gets cached. Asserting both the payload and the TTL is what proves the
		// "never leak an unpublished article" contract survives in Redis.
		const negativeRevision = await appRedis?.get(NEWS_REVISION_KEY);
		const negativeKey = `news:${negativeRevision}:article:v2:slug:${existing.slug}`;
		expect(await appRedis?.get(negativeKey)).toBe("null");
		expect(await appRedis?.ttl(negativeKey)).toBeGreaterThan(0);

		const body = `<p>${"Contenuto completo è 📰 ".repeat(4000)}</p>`;
		const publish = articleForm({
			id: String(existing.id),
			baseToken: articleEditToken(existing),
			status: "published",
			fullStory: body,
		});
		const published = await Promise.all([
			articles.updateArticle(publish),
			articles.updateArticle(publish),
		]);
		expect(published[0]).toMatchObject({ ok: true });
		expect(published[1]).toEqual(published[0]);
		const saved = await savedArticle();
		expect(saved).toMatchObject({
			status: "published",
			fullStory: body,
			publishAt: null,
		});
		expect(saved.publishedAt).toBeInstanceOf(Date);
		const revisions = await rows(
			"SELECT payload FROM website_article_revisions",
		);
		expect(revisions).toHaveLength(1);
		expect(JSON.parse(revisions[0].payload)).toMatchObject({
			status: "draft",
			fullStory: existing.fullStory,
		});
		const history = await rows(
			"SELECT target,`before`,`after` FROM admin_audit_log",
		);
		expect(history).toHaveLength(1);
		expect(history[0].target).toBe("news");
		expect(JSON.parse(history[0].before)).toMatchObject({
			status: "draft",
			fullStory: existing.fullStory,
		});
		expect(JSON.parse(history[0].after)).toMatchObject({
			status: "published",
			fullStory: body,
		});
		expect(await rows("SELECT kind FROM cms_operations ORDER BY kind")).toEqual(
			[{ kind: "news.create" }, { kind: "news.update" }],
		);
		expect(await rows("SELECT topic,status FROM cms_outbox")).toEqual([
			{ topic: "news.refresh", status: "pending" },
			{ topic: "news.refresh", status: "pending" },
		]);
		expect(boundaries.notify).toHaveBeenCalledOnce();
		await worker.drainOperationEffects();
		expect(await rows("SELECT status FROM cms_outbox")).toEqual([
			{ status: "done" },
			{ status: "done" },
		]);
		expect(await appRedis?.get(NEWS_REVISION_KEY)).not.toBe(negativeRevision);
		expect(await publicNews.getPublishedArticle(existing.slug)).toMatchObject({
			id: existing.id,
			fullStory: body,
			slug: existing.slug,
		});
		const publicKey = `news:${await appRedis?.get(NEWS_REVISION_KEY)}:article:v2:slug:${existing.slug}`;
		expect(JSON.parse(String(await appRedis?.get(publicKey)))).toMatchObject({
			id: String(existing.id),
			fullStory: body,
		});
		cache.invalidateMemory(publicKey);
		const fromRedis = await publicNews.getPublishedArticle(existing.slug);
		expect(fromRedis?.id).toBe(existing.id);
		expect(fromRedis?.publishedAt).toEqual(saved.publishedAt);
	});

	it("rolls back publication, revision, audit and operation when queuing its effect fails, then retries the same submit", async () => {
		expect(await articles.createArticle(articleForm())).toMatchObject({
			ok: true,
		});
		const existing = await savedArticle();
		const publish = articleForm({
			id: String(existing.id),
			baseToken: articleEditToken(existing),
			status: "published",
		});
		const operationsBefore = await rows("SELECT * FROM cms_operations");
		const effectsBefore = await rows("SELECT * FROM cms_outbox");
		await connection?.query(
			"CREATE TRIGGER reject_news_effect BEFORE INSERT ON cms_outbox FOR EACH ROW BEGIN IF NEW.topic='news.refresh' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced news effect failure'; END IF; END",
		);
		expect(await articles.updateArticle(publish)).toMatchObject({ ok: false });
		expect(await savedArticle()).toEqual(existing);
		expect(await rows("SELECT id FROM website_article_revisions")).toHaveLength(
			0,
		);
		expect(await rows("SELECT id FROM admin_audit_log")).toHaveLength(0);
		expect(await rows("SELECT * FROM cms_operations")).toEqual(
			operationsBefore,
		);
		expect(await rows("SELECT * FROM cms_outbox")).toEqual(effectsBefore);
		expect(boundaries.notify).not.toHaveBeenCalled();
		await connection?.query("DROP TRIGGER reject_news_effect");
		expect(await articles.updateArticle(publish)).toMatchObject({ ok: true });
		expect(await articles.updateArticle(publish)).toMatchObject({ ok: true });
		expect((await savedArticle()).status).toBe("published");
		expect(await rows("SELECT id FROM website_article_revisions")).toHaveLength(
			1,
		);
		expect(await rows("SELECT id FROM admin_audit_log")).toHaveLength(1);
		expect(await rows("SELECT id FROM cms_operations")).toHaveLength(2);
		expect(await rows("SELECT id FROM cms_outbox")).toHaveLength(2);
		expect(boundaries.notify).toHaveBeenCalledOnce();
	});

	it("rolls back the entire scheduled batch if its second effect cannot be queued", async () => {
		const now = new Date(Math.floor(Date.now() / 1000) * 1000);
		await seedScheduledArticles(now);
		const before = await rows("SELECT * FROM website_articles ORDER BY id");
		await connection?.query(
			"CREATE TRIGGER reject_second_scheduled_effect BEFORE INSERT ON cms_outbox FOR EACH ROW BEGIN IF NEW.topic='news.refresh' AND (SELECT COUNT(*) FROM cms_operations WHERE kind='news.schedule.publish')=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced second scheduled effect failure'; END IF; END",
		);
		await expect(scheduler.publishDueArticles(now)).rejects.toThrow();
		expect(await rows("SELECT * FROM website_articles ORDER BY id")).toEqual(
			before,
		);
		expect(await rows("SELECT id FROM cms_operations")).toHaveLength(0);
		expect(await rows("SELECT id FROM cms_outbox")).toHaveLength(0);
		await connection?.query("DROP TRIGGER reject_second_scheduled_effect");
		expect(await scheduler.publishDueArticles(now)).toBe(2);
		expect(await rows("SELECT id FROM cms_operations")).toHaveLength(2);
		expect(await rows("SELECT topic,status FROM cms_outbox")).toEqual([
			{ topic: "news.refresh", status: "pending" },
			{ topic: "news.refresh", status: "pending" },
		]);
	});

	it("serializes competing scheduler ticks without duplicate effects or early publication", async () => {
		const now = new Date(Math.floor(Date.now() / 1000) * 1000);
		await seedScheduledArticles(now);
		const untouched = await rows(
			"SELECT * FROM website_articles WHERE id IN (3,4,5) ORDER BY id",
		);
		expect(await publicNews.getPublishedArticle("due-earlier")).toBeNull();
		expect(await publicNews.getPublishedArticle("due-now")).toBeNull();
		const results = await Promise.all([
			scheduler.publishDueArticles(now),
			scheduler.publishDueArticles(now),
		]);
		expect(results.sort()).toEqual([0, 2]);
		expect(await scheduler.publishDueArticles(now)).toBe(0);
		expect(
			await rows(
				"SELECT * FROM website_articles WHERE id IN (3,4,5) ORDER BY id",
			),
		).toEqual(untouched);
		const published = await rows(
			"SELECT CAST(id AS CHAR) AS id,status,published_at FROM website_articles WHERE id IN (1,9007199254740993) ORDER BY id",
		);
		expect(published).toEqual([
			{ id: "1", status: "published", published_at: now },
			{ id: "9007199254740993", status: "published", published_at: now },
		]);
		const recorded = await rows(
			"SELECT actor_id,kind,result_json FROM cms_operations ORDER BY actor_id",
		);
		expect(recorded).toHaveLength(2);
		expect(
			recorded.map((entry) => ({
				actor: entry.actor_id,
				kind: entry.kind,
				result: JSON.parse(entry.result_json),
			})),
		).toEqual([
			{
				actor: 0,
				kind: "news.schedule.publish",
				result: {
					articleId: "9007199254740993",
					articleTitle: "due-now",
					published: true,
				},
			},
			{
				actor: 7,
				kind: "news.schedule.publish",
				result: {
					articleId: "1",
					articleTitle: "due-earlier",
					published: true,
				},
			},
		]);
		expect(await rows("SELECT topic,status FROM cms_outbox")).toEqual([
			{ topic: "news.refresh", status: "pending" },
			{ topic: "news.refresh", status: "pending" },
		]);
		await worker.drainOperationEffects();
		expect(await publicNews.getPublishedArticle("due-earlier")).toMatchObject({
			id: 1n,
		});
		expect(await publicNews.getPublishedArticle("due-now")).toMatchObject({
			id: 9007199254740993n,
		});
		expect(await publicNews.getPublishedArticle("future")).toBeNull();
		expect(await publicNews.getPublishedArticle("draft")).toBeNull();
	});

	it("keeps a committed publication readable during Redis disconnect and repairs cached absence through a retried delivery", async () => {
		if (!appRedis) throw Error("Redis must be enabled in integration tests");
		const redis = appRedis;
		expect(await articles.createArticle(articleForm())).toMatchObject({
			ok: true,
		});
		await worker.drainOperationEffects();
		const existing = await savedArticle();
		expect(await publicNews.getPublishedArticle(existing.slug)).toBeNull();
		const negativeRevision = await redis.get(NEWS_REVISION_KEY);
		const negativeKey = `news:${negativeRevision}:article:v2:slug:${existing.slug}`;
		// Cached negative results are stored as the JSON encoding of null.
		expect(await redis.get(negativeKey)).toBe("null");
		const publish = articleForm({
			id: String(existing.id),
			baseToken: articleEditToken(existing),
			status: "published",
		});
		const disconnected = once(redis, "end");
		redis.disconnect();
		await disconnected;
		try {
			expect(redis.status).toBe("end");
			expect(await articles.updateArticle(publish)).toMatchObject({ ok: true });
			expect((await savedArticle()).status).toBe("published");
			expect(await publicNews.getPublishedArticle(existing.slug)).toMatchObject(
				{ id: existing.id },
			);
			await worker.drainOperationEffects();
			const [pending] = await rows(
				"SELECT status,attempts,last_error FROM cms_outbox WHERE status<>'done'",
			);
			expect(pending).toMatchObject({ status: "pending", attempts: 1 });
			expect(pending.last_error).toBeTruthy();
			await redis.connect();
			expect(await redis.ping()).toBe("PONG");
			expect(await redis.get(NEWS_REVISION_KEY)).toBe(negativeRevision);
			expect(await publicNews.getPublishedArticle(existing.slug)).toBeNull();
			// Make the real queued retry due without a wall-clock sleep.
			await connection?.query(
				"UPDATE cms_outbox SET available_at=UTC_TIMESTAMP(3) WHERE status='pending'",
			);
			await worker.drainOperationEffects();
			expect(
				await rows(
					"SELECT status,attempts,last_error FROM cms_outbox ORDER BY attempts",
				),
			).toEqual([
				{ status: "done", attempts: 1, last_error: null },
				{ status: "done", attempts: 2, last_error: null },
			]);
			expect(await redis.get(NEWS_REVISION_KEY)).not.toBe(negativeRevision);
			expect(await publicNews.getPublishedArticle(existing.slug)).toMatchObject(
				{ id: existing.id, fullStory: existing.fullStory },
			);
			expect(await articles.updateArticle(publish)).toMatchObject({ ok: true });
			expect(await rows("SELECT id FROM website_articles")).toHaveLength(1);
			expect(
				await rows("SELECT id FROM website_article_revisions"),
			).toHaveLength(1);
			expect(await rows("SELECT id FROM cms_operations")).toHaveLength(2);
			expect(await rows("SELECT id FROM cms_outbox")).toHaveLength(2);
			expect(boundaries.notify).toHaveBeenCalledOnce();
		} finally {
			if (redis.status === "end") await redis.connect();
		}
	});
});

async function seedCommentArticles() {
	if (!connection) throw Error("Integration database is not connected");
	await connection.query(
		"INSERT INTO website_articles (id,slug,title,short_story,full_story,image,status,publish_at) VALUES (101,'comment-public','Public','','','','published',NULL),(102,'comment-draft','Draft','','','','draft',NULL),(103,'comment-future','Future','','','','published',DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY)),(104,'comment-due','Due','','','','published',DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY))",
	);
}

describe("real comment publication, moderation and shared quota", () => {
	it("checks both target forms with MariaDB and rejects blocked text through the real word filter", async () => {
		await seedCommentArticles();
		for (const userId of [8, 9]) {
			for (const [id, slug, eligible] of [
				[101, "comment-public", true],
				[102, "comment-draft", false],
				[103, "comment-future", false],
				[104, "comment-due", true],
			] as const) {
				const result = await commentSubmission.submitArticleComment({
					userId,
					target: userId === 8 ? { id: String(id) } : { slug },
					comment: "Database verified",
				});
				expect(result).toEqual(
					eligible ? { ok: true, slug } : { ok: false, reason: "not_found" },
				);
			}
		}
		expect(
			await rows(
				"SELECT article_id,user_id,comment FROM website_article_comments ORDER BY id",
			),
		).toEqual([
			{ article_id: "101", user_id: 8, comment: "Database verified" },
			{ article_id: "104", user_id: 8, comment: "Database verified" },
			{ article_id: "101", user_id: 9, comment: "Database verified" },
			{ article_id: "104", user_id: 9, comment: "Database verified" },
		]);
		await connection?.query(
			"INSERT INTO website_wordfilter (word) VALUES ('blocked-content')",
		);
		commentModeration.reloadWordFilter();
		expect(
			await commentSubmission.submitArticleComment({
				userId: 8,
				target: { slug: "comment-public" },
				comment: "BLOCKED-CONTENT",
			}),
		).toEqual({ ok: false, reason: "moderated" });
		expect(await rows("SELECT id FROM website_article_comments")).toHaveLength(
			4,
		);
	});

	it("shares the Redis bucket when alternating the real form and API handlers", async () => {
		if (!appRedis) throw Error("Redis must be enabled in integration tests");
		await seedCommentArticles();
		const form = new FormData();
		form.set("articleId", "101");
		form.set("slug", "comment-public");
		form.set("comment", "Shared quota");
		form.set("userId", "999");
		const api = () =>
			commentApi.POST(
				new Request("https://hotel.test/api/articles/comment-public/comment", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ comment: "Shared quota", userId: 999 }),
				}),
				{ params: Promise.resolve({ slug: "comment-public" }) },
			);
		for (let attempt = 0; attempt < 5; attempt++) {
			if (attempt % 2 === 0) {
				await expect(commentAction.postComment(form)).rejects.toThrow(
					"/news/comment-public?comment=posted",
				);
			} else {
				const response = await api();
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({ ok: true });
			}
		}
		const limited = await api();
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
		await expect(commentAction.postComment(form)).rejects.toThrow(
			"/news/comment-public?error=ratelimit",
		);
		expect(await appRedis.get("ratelimit:comment:7")).toBe("7");
		expect(await appRedis.pttl("ratelimit:comment:7")).toBeGreaterThan(0);
		expect(await appRedis.pttl("ratelimit:comment:7")).toBeLessThanOrEqual(
			30_000,
		);
		expect(
			await rows("SELECT user_id,comment FROM website_article_comments"),
		).toEqual(
			Array.from({ length: 5 }, () => ({
				user_id: 7,
				comment: "Shared quota",
			})),
		);
	});
});

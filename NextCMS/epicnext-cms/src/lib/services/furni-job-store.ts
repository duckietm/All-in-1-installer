import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ImportJob } from "@/lib/furni/import-job";
import { retryableJobItems } from "@/lib/furni/import-job-retry";
export const importRoot = () =>
	path.join(process.cwd(), "storage", "furniture-imports");
export const validJobId = (value: unknown): value is string =>
	typeof value === "string" &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value,
	);
export class ImportRequestConflict extends Error {
	constructor() {
		super("Request ID already used");
	}
}
export class ImportJobStore {
	constructor(readonly root = importRoot()) {}
	async save(job: ImportJob) {
		await fs.mkdir(this.root, { recursive: true });
		const target = path.join(this.root, `${job.id}.json`),
			tmp = `${target}.${randomUUID()}.tmp`;
		job.updatedAt = new Date().toISOString();
		await fs.writeFile(tmp, JSON.stringify(job));
		await fs.rename(tmp, target);
	}
	async create(job: ImportJob) {
		if (!validJobId(job.id)) throw Error("Invalid import ID");
		await fs.mkdir(this.root, { recursive: true });
		const tmp = path.join(this.root, `${randomUUID()}.tmp`);
		await fs.writeFile(tmp, JSON.stringify(job));
		try {
			await fs.link(tmp, path.join(this.root, `${job.id}.json`));
			return job;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existing = await this.read(job.id);
			if (
				existing.userId !== job.userId ||
				existing.requestFingerprint !== job.requestFingerprint
			)
				throw new ImportRequestConflict();
			return existing;
		} finally {
			await fs.unlink(tmp);
		}
	}
	async read(id: string): Promise<ImportJob> {
		if (!validJobId(id)) throw Error("Invalid import ID");
		const job: ImportJob = JSON.parse(
			await fs.readFile(path.join(this.root, `${id}.json`), "utf8"),
		);
		if (await this.isCancellationRequested(id)) job.cancelRequested = true;
		return job;
	}
	async isCancellationRequested(id: string): Promise<boolean> {
		if (!validJobId(id)) throw Error("Invalid import ID");
		try {
			await fs.access(path.join(this.root, `${id}.cancel`));
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}
	/** Cancellation has its own durable marker: a worker save cannot overwrite it. */
	async requestCancellation(
		id: string,
		userId: number,
	): Promise<ImportJob | null> {
		const job = await this.read(id).catch((error) => {
			if (error.code === "ENOENT") return null;
			throw error;
		});
		if (!job || job.userId !== userId) return null;
		if (job.state !== "queued" && job.state !== "running") return job;
		await fs
			.writeFile(path.join(this.root, `${id}.cancel`), "cancel", { flag: "wx" })
			.catch((error) => {
				if (error.code !== "EEXIST") throw error;
			});
		return this.read(id);
	}
	async retry(
		id: string,
		userId: number,
		attachments: Record<string, string> = {},
	): Promise<ImportJob | null> {
		const original = await this.read(id).catch((error) => {
			if (error.code === "ENOENT") return null;
			throw error;
		});
		if (!original || original.userId !== userId) return null;
		const items = retryableJobItems(original);
		if (!items.length) return null;
		const entries = Object.entries(attachments);
		if (
			entries.length &&
			(original.syncKind ||
				entries.some(
					([classname]) =>
						!items.some(
							(item) => item.classname === classname && item.state === "failed",
						),
				))
		)
			throw Error("Furniture is not eligible for attachment recovery");
		// A parent produces one durable child, including concurrent and uncertain responses.
		const hex = createHash("sha256").update(`retry:${id}`).digest("hex");
		const retryId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
		const now = new Date().toISOString();
		const child = await this.create({
			...original,
			id: retryId,
			retryOf: id,
			requestFingerprint: undefined,
			createdAt: now,
			updatedAt: now,
			state: "queued",
			cancelRequested: false,
			items: items.map(
				({
					error: _error,
					warnings: _warnings,
					itemId: _itemId,
					phase: _phase,
					phaseStartedAt: _phaseStartedAt,
					sourceAttempt: _sourceAttempt,
					recoveredSource: _recoveredSource,
					...item
				}) => ({
					...item,
					...(Object.hasOwn(attachments, item.classname)
						? { attachmentId: attachments[item.classname] }
						: {}),
					state: "pending",
				}),
			),
		});
		if (
			entries.some(
				([classname, attachmentId]) =>
					child.items.find((item) => item.classname === classname)
						?.attachmentId !== attachmentId,
			)
		)
			throw Error(
				"Recovery already started. Use the latest retry in the history.",
			);
		return child;
	}
	async page(options: { userId: number; limit: number; before?: string }) {
		const limit = Math.min(30, Math.max(1, options.limit));
		const key = (job: ImportJob) => `${job.createdAt}|${job.id}`;
		const jobs = (await this.list())
			.filter(
				(job) =>
					job.userId === options.userId &&
					(!options.before || key(job) < options.before),
			)
			.sort((a, b) => key(b).localeCompare(key(a)));
		const page = jobs.slice(0, limit);
		return {
			jobs: page,
			nextCursor: jobs.length > limit ? key(page[page.length - 1]) : null,
		};
	}

	async list(options?: {
		userId: number;
		limit: number;
	}): Promise<ImportJob[]> {
		const files = await fs.readdir(this.root).catch((error) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
		const candidates: Array<{ id: string; modified: number }> = [];
		// Metadata and payload reads are sequential, avoiding thousands of concurrent opens.
		for (const file of files) {
			if (!file.endsWith(".json") || !validJobId(file.slice(0, -5))) continue;
			const stat = await fs.stat(path.join(this.root, file));
			candidates.push({ id: file.slice(0, -5), modified: stat.mtimeMs });
		}
		candidates.sort((a, b) =>
			options ? b.modified - a.modified : a.modified - b.modified,
		);
		const jobs: ImportJob[] = [];
		const limit = options ? Math.min(30, Math.max(1, options.limit)) : Infinity;
		for (const candidate of candidates) {
			const job = await this.read(candidate.id);
			if (options && job.userId !== options.userId) continue;
			jobs.push(job);
			if (jobs.length >= limit) break;
		}
		return options
			? jobs
			: jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}
}

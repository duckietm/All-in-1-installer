import { createHash, randomUUID } from "node:crypto";
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

export function redactErrorText(value: string): string {
	return value
		.slice(0, 12000)
		.replace(
			/(https?:\/\/|mysql:\/\/|redis:\/\/)[^\s/@]+:[^\s/@]+@/gi,
			"$1[REDACTED]@",
		)
		.replace(/([?&])[^\s#)]+/g, "$1[REDACTED]")
		.replace(
			/((?:password|secret|token|authorization|cookie|api[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
			"$1[REDACTED]",
		)
		.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
}
export interface CmsErrorRecord {
	id: string;
	resolved?: boolean;
	assignment?: { userId: number; at: string } | null;
	at: string;
	source: "server" | "browser";
	event: string;
	message: string;
	stack: string;
	release: string;
	fingerprint: string;
	context: Record<string, string | number | boolean | null>;
}
export function createErrorRecord(
	source: CmsErrorRecord["source"],
	event: string,
	error: unknown,
	context: Record<string, unknown> = {},
): CmsErrorRecord {
	const message = redactErrorText(
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Unknown error",
	);
	const stack =
		error instanceof Error ? redactErrorText(error.stack ?? "") : "";
	const safeContext = Object.fromEntries(
		Object.entries(context)
			.slice(0, 24)
			.map(([key, value]) => [
				key,
				/password|secret|token|cookie|authorization|body|query|email|api[_-]?key/i.test(
					key,
				)
					? "[REDACTED]"
					: typeof value === "string"
						? redactErrorText(value).slice(0, 1000)
						: typeof value === "number" ||
								typeof value === "boolean" ||
								value === null
							? value
							: "[NON_SCALAR]",
			]),
	);
	return {
		id: randomUUID(),
		at: new Date().toISOString(),
		source,
		event: redactErrorText(event).slice(0, 160),
		message,
		stack,
		release: process.env.NEXT_PUBLIC_CMS_RELEASE ?? "unknown",
		fingerprint: createHash("sha256")
			.update(`${source}:${event}:${message}:${stack.split("\n")[1] ?? ""}`)
			.digest("hex")
			.slice(0, 16),
		context: safeContext,
	};
}
const DAY_LIMIT = 10 * 1024 * 1024;
const RETENTION_DAYS = 7;
export class ErrorStore {
	private static queue: Promise<void> = Promise.resolve();
	private static pending = 0;
	constructor(
		private directory = path.join(process.cwd(), "storage", "cms-errors"),
	) {}
	async append(record: CmsErrorRecord) {
		if (ErrorStore.pending >= 100) throw new Error("Error storage queue full");
		ErrorStore.pending++;
		const write = ErrorStore.queue.then(() => this.writeRecord(record));
		ErrorStore.queue = write.catch(() => {});
		try {
			await write;
		} finally {
			ErrorStore.pending--;
		}
	}
	private async writeRecord(record: CmsErrorRecord) {
		await mkdir(this.directory, { recursive: true });
		const files = await readdir(this.directory);
		const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000)
			.toISOString()
			.slice(0, 10);
		for (const name of files)
			if (
				/^\d{4}-\d{2}-\d{2}(\.jsonl|\.[a-f0-9]{16}\.(?:resolved|assignment)(?:\.[a-f0-9-]+\.tmp)?)$/.test(
					name,
				) &&
				name.slice(0, 10) < cutoff
			)
				await unlink(path.join(this.directory, name)).catch(() => {});
		const file = path.join(this.directory, `${record.at.slice(0, 10)}.jsonl`);
		const size = await stat(file)
			.then((s) => s.size)
			.catch(() => 0);
		if (size >= DAY_LIMIT) throw new Error("Daily error storage limit reached");
		await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
	}
	async resolve(fingerprint: string) {
		if (!/^[a-f0-9]{16}$/.test(fingerprint))
			throw new Error("Invalid fingerprint");
		const { records } = await this.read();
		if (!records.some((r) => r.fingerprint === fingerprint))
			throw new Error("Error group no longer available");
		const now = new Date().toISOString();
		await writeFile(
			path.join(this.directory, `${now.slice(0, 10)}.${fingerprint}.resolved`),
			now,
			{ mode: 0o600 },
		);
	}
	async assign(fingerprint: string, userId: number | null) {
		if (!/^[a-f0-9]{16}$/.test(fingerprint))
			throw new Error("Invalid fingerprint");
		if (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0))
			throw new Error("Invalid assignee");
		if (ErrorStore.pending >= 100) throw new Error("Error storage queue full");
		ErrorStore.pending++;
		const write = ErrorStore.queue.then(async () => {
			const { records } = await this.read();
			if (!records.some((record) => record.fingerprint === fingerprint))
				throw new Error("Error group no longer available");
			const at = new Date().toISOString();
			const file = path.join(
				this.directory,
				`${at.slice(0, 10)}.${fingerprint}.assignment`,
			);
			const metadata = (await readdir(this.directory)).filter(
				(name) =>
					name.startsWith(at.slice(0, 10)) && name.endsWith(".assignment"),
			);
			if (metadata.length >= 1000 && !metadata.includes(path.basename(file)))
				throw new Error("Daily assignment storage limit reached");
			const temp = `${file}.${randomUUID()}.tmp`;
			try {
				await writeFile(temp, JSON.stringify({ userId, at }), { mode: 0o600 });
				await rename(temp, file);
			} finally {
				await unlink(temp).catch(() => {});
			}
		});
		ErrorStore.queue = write.catch(() => {});
		try {
			await write;
		} finally {
			ErrorStore.pending--;
		}
	}
	async read(): Promise<{ records: CmsErrorRecord[]; truncated: boolean }> {
		const files = await readdir(this.directory).catch(
			(e: NodeJS.ErrnoException) => {
				if (e.code === "ENOENT") return [];
				throw e;
			},
		);
		const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000)
			.toISOString()
			.slice(0, 10);
		const assignments = new Map<string, CmsErrorRecord["assignment"]>();
		for (const name of files
			.filter(
				(f) =>
					/^\d{4}-\d{2}-\d{2}\.[a-f0-9]{16}\.assignment$/.test(f) &&
					f.slice(0, 10) >= cutoff,
			)
			.sort()) {
			const file = path.join(this.directory, name);
			if ((await stat(file)).size > 512) continue;
			try {
				const value = JSON.parse(await readFile(file, "utf8"));
				if (
					typeof value.at !== "string" ||
					!Number.isFinite(Date.parse(value.at))
				)
					continue;
				if (value.userId === null) assignments.set(name.split(".")[1], null);
				else if (Number.isSafeInteger(value.userId) && value.userId > 0)
					assignments.set(name.split(".")[1], {
						userId: value.userId,
						at: value.at,
					});
			} catch {
				/* Ignore interrupted or malformed metadata. */
			}
		}
		const resolved = new Map<string, string>();
		for (const name of files
			.filter(
				(f) =>
					/^\d{4}-\d{2}-\d{2}\.[a-f0-9]{16}\.resolved$/.test(f) &&
					f.slice(0, 10) >= cutoff,
			)
			.sort()) {
			const at = await readFile(path.join(this.directory, name), "utf8");
			resolved.set(name.split(".")[1], at);
		}
		const records: CmsErrorRecord[] = [];
		for (const name of files
			.filter(
				(f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) >= cutoff,
			)
			.sort()
			.reverse()) {
			const file = path.join(this.directory, name);
			if ((await stat(file)).size > DAY_LIMIT + 100000) continue;
			const lines = (await readFile(file, "utf8")).trim().split("\n").reverse();
			for (const line of lines) {
				try {
					const r = JSON.parse(line);
					if (r.id && r.fingerprint)
						records.push({
							...r,
							resolved: (resolved.get(r.fingerprint) ?? "") >= r.at,
							assignment: assignments.get(r.fingerprint) ?? null,
						});
				} catch {
					/* Ignore an interrupted final write. */
				}
				if (records.length >= 1000) return { records, truncated: true };
			}
		}
		return { records, truncated: false };
	}
}
const store = new ErrorStore();
let pending = 0;
let lastFailure = 0;
export function captureCmsError(
	source: CmsErrorRecord["source"],
	event: string,
	error: unknown,
	context: Record<string, unknown> = {},
) {
	const record = createErrorRecord(source, event, error, context);
	if (process.env.NODE_ENV === "test" || process.env.VITEST || pending >= 100)
		return record.id;
	pending++;
	void store
		.append(record)
		.catch(() => {
			if (Date.now() - lastFailure > 60000) {
				lastFailure = Date.now();
				process.stderr.write(
					"CMS error monitor could not persist an event; check storage permissions or daily quota.\n",
				);
			}
		})
		.finally(() => {
			pending--;
		});
	return record.id;
}

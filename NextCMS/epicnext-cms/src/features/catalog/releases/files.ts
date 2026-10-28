import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";

export interface FileDigest {
	bytes: number;
	sha256: string;
	gitSha1: string;
	gitSha256: string;
}
export async function sourceFingerprint(source: string): Promise<string> {
	const stat = await fs.lstat(source, { bigint: true });
	if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error("Invalid catalog source");
	return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
export async function digestFile(source: string): Promise<FileDigest> {
	const before = await sourceFingerprint(source);
	const stat = await fs.stat(source);
	const sha256 = createHash("sha256");
	const header = `blob ${stat.size}\0`;
	const gitSha1 = createHash("sha1").update(header);
	const gitSha256 = createHash("sha256").update(header);
	let bytes = 0;
	for await (const chunk of createReadStream(source)) {
		bytes += chunk.length;
		sha256.update(chunk);
		gitSha1.update(chunk);
		gitSha256.update(chunk);
	}
	if (bytes !== stat.size || before !== (await sourceFingerprint(source)))
		throw new Error("Assets changed during export; retry required");
	return {
		bytes,
		sha256: sha256.digest("hex"),
		gitSha1: gitSha1.digest("hex"),
		gitSha256: gitSha256.digest("hex"),
	};
}

export function verifyStagedRelease(
	index: string,
	format: string,
	expected: Map<string, FileDigest>,
): void {
	if (format !== "sha1" && format !== "sha256")
		throw new Error("Unsupported Git object format");
	const staged = new Map(
		index
			.split("\0")
			.filter(Boolean)
			.map((entry) => {
				const tab = entry.indexOf("\t");
				return [entry.slice(tab + 1), entry.slice(0, tab).split(" ")] as const;
			}),
	);
	for (const [target, digest] of expected) {
		const entry = staged.get(target);
		const hash = format === "sha1" ? digest.gitSha1 : digest.gitSha256;
		if (
			!entry ||
			!["100644", "100755"].includes(entry[0]) ||
			entry[1] !== hash ||
			entry[2] !== "0"
		)
			throw new Error(`Staged catalog bytes mismatch: ${target}`);
	}
}

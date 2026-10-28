import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
} from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { CATALOG_BRANCH, CATALOG_REMOTE } from "./catalog-git-core";
export interface ManagedCatalogConfig {
	enabled: boolean;
	remote: string;
	branch: string;
	username: string;
	encryptedToken: string;
}
export function catalogStateRoot() {
	return (
		process.env.CATALOG_GIT_STATE_DIR ||
		path.join(process.cwd(), "storage", "catalog-git")
	);
}
export function readManagedCatalogConfig(): ManagedCatalogConfig | null {
	try {
		return JSON.parse(
			readFileSync(path.join(catalogStateRoot(), "config.json"), "utf8"),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new Error("Catalog Git configuration cannot be read");
	}
}
function key() {
	const secret = process.env.AUTH_SECRET;
	if (!secret)
		throw new Error("The application authentication secret is unavailable");
	return createHash("sha256").update(secret).digest();
}
export function encryptCatalogToken(token: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(), iv);
	const value = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
	return [iv, cipher.getAuthTag(), value]
		.map((part) => part.toString("base64"))
		.join(".");
}
export function decryptCatalogToken(value: string) {
	if (!value) return "";
	const [iv, tag, data] = value
		.split(".")
		.map((part) => Buffer.from(part, "base64"));
	const cipher = createDecipheriv("aes-256-gcm", key(), iv);
	cipher.setAuthTag(tag);
	return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export function validateCatalogConfig(
	input: unknown,
	previous: ManagedCatalogConfig | null,
): ManagedCatalogConfig {
	const value = input as Record<string, unknown>;
	if (
		!value ||
		typeof value.remote !== "string" ||
		typeof value.branch !== "string" ||
		typeof value.username !== "string" ||
		typeof value.enabled !== "boolean"
	)
		throw new Error(
			"Repository, branch, username and enabled state are required",
		);
	let url: URL;
	try {
		url = new URL(value.remote.trim());
	} catch {
		throw new Error("Enter a valid HTTPS Gitea repository URL");
	}
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!/^\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname)
	)
		throw new Error(
			"Use an HTTPS repository URL without credentials or query parameters",
		);
	const remote = `${url
		.toString()
		.replace(/\/$/, "")
		.replace(/\.git$/, "")}.git`;
	const branch = value.branch.trim(),
		username = value.username.trim();
	if (
		!branch ||
		branch.startsWith("-") ||
		branch.startsWith("/") ||
		branch.endsWith("/") ||
		branch.endsWith(".") ||
		branch.includes("..") ||
		branch.includes("//") ||
		branch.includes("@{") ||
		/[\s~^:?*[\\]/.test(branch) ||
		[...branch].some(
			(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
		) ||
		branch
			.split("/")
			.some((part) => part.startsWith(".") || part.endsWith(".lock")) ||
		branch === "@"
	)
		throw new Error("Enter a valid Git branch");
	if (!username || /[\r\n:]/.test(username))
		throw new Error("Enter a valid Gitea username");
	const token = typeof value.token === "string" ? value.token.trim() : "";
	if (/[\r\n]/.test(token)) throw new Error("Invalid access token");
	const same = previous?.remote === remote && previous.username === username;
	const encryptedToken = token
		? encryptCatalogToken(token)
		: same
			? previous.encryptedToken
			: "";
	if (value.enabled && !encryptedToken)
		throw new Error("Provide a Gitea token before enabling export");
	return { enabled: value.enabled, remote, branch, username, encryptedToken };
}
export function publicCatalogConfig(config = readManagedCatalogConfig()) {
	return {
		provider: "gitea",
		enabled: config?.enabled ?? false,
		remote: config?.remote ?? CATALOG_REMOTE,
		branch: config?.branch ?? CATALOG_BRANCH,
		username: config?.username ?? "",
		hasToken: !!config?.encryptedToken,
	};
}
export async function saveCatalogConfig(config: ManagedCatalogConfig) {
	const root = catalogStateRoot();
	await fs.mkdir(root, { recursive: true });
	const temp = path.join(root, `config-${randomUUID()}.tmp`);
	try {
		await fs.writeFile(temp, JSON.stringify(config), {
			mode: 0o600,
			flag: "wx",
		});
		await fs.rename(temp, path.join(root, "config.json"));
	} finally {
		await fs.rm(temp, { force: true });
	}
}
export function catalogGitEnvironment(
	config: ManagedCatalogConfig,
): NodeJS.ProcessEnv {
	const token = decryptCatalogToken(config.encryptedToken);
	return {
		...process.env,
		GIT_TERMINAL_PROMPT: "0",
		GIT_CONFIG_COUNT: "2",
		GIT_CONFIG_KEY_0: `http.${new URL(config.remote).origin}/.extraHeader`,
		GIT_CONFIG_VALUE_0:
			"Authorization: Basic " +
			Buffer.from(`${config.username}:${token}`).toString("base64"),
		GIT_CONFIG_KEY_1: "http.followRedirects",
		GIT_CONFIG_VALUE_1: "false",
	};
}
export function managedCatalogCheckout(config: ManagedCatalogConfig) {
	return path.join(
		catalogStateRoot(),
		"checkouts",
		createHash("sha256")
			.update(`${config.remote}\n${config.branch}`)
			.digest("hex")
			.slice(0, 24),
	);
}

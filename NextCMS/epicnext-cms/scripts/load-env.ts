import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Standalone scripts (tsx) don't auto-load .env like Next.js does, so the
// deploy step symlinks ${LIVE}/.env into the stage but nothing ever read it.
// Node's loadEnvFile() never overrides already-set variables, so real shell
// env wins; we load .env.local first so it takes precedence over .env.
function loadEnvFile(): void {
	for (const name of [".env.local", ".env"]) {
		const file = resolve(ROOT, name);
		if (existsSync(file)) process.loadEnvFile(file);
	}
}

loadEnvFile();

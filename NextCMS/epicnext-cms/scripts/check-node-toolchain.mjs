import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (path) =>
	readFileSync(resolve(projectRoot, path), "utf8");

const pinnedVersion = readProjectFile(".nvmrc").trim();
assert.match(
	pinnedVersion,
	/^\d+\.\d+\.\d+$/,
	".nvmrc must pin an exact Node.js version",
);

const major = Number.parseInt(pinnedVersion.split(".")[0], 10);
const packageJson = JSON.parse(readProjectFile("package.json"));

assert.equal(
	packageJson.engines?.node,
	`>=${pinnedVersion} <${major + 1}`,
	"package.json engines.node must match the .nvmrc release line",
);
assert.equal(
	Number.parseInt(packageJson.devDependencies?.["@types/node"], 10),
	major,
	"@types/node must match the pinned Node.js major",
);

const nodeImages = [
	...readProjectFile("Dockerfile").matchAll(
		/^FROM\s+(?:--platform=\S+\s+)?node:([^\s]+)\s*/gim,
	),
].map((match) => match[1]);
assert.ok(
	nodeImages.length > 0,
	"Dockerfile must declare a pinned Node.js base image",
);
for (const image of nodeImages) {
	assert.equal(
		image,
		`${pinnedVersion}-alpine`,
		"every Docker Node.js stage must match .nvmrc",
	);
}

const cmpVersion = (a, b) => {
	const pa = a.split(".").map((part) => Number.parseInt(part, 10));
	const pb = b.split(".").map((part) => Number.parseInt(part, 10));
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
};

// `.nvmrc` is the recommended version for reproducible local development and
// the exact Docker base image (both asserted above), but the *runtime* we run
// on may be any version the package.json engines range accepts. Requiring an
// exact patch match here would fail on every Node.js patch release, even when
// the version is explicitly supported.
if (!process.argv.includes("--static")) {
	const active = process.versions.node;
	const upperBound = `${major + 1}.0.0`;
	assert.ok(
		cmpVersion(active, pinnedVersion) >= 0 &&
			cmpVersion(active, upperBound) < 0,
		`the active Node.js runtime (${active}) must satisfy package.json engines.node (${packageJson.engines.node}); .nvmrc pins ${pinnedVersion} as the recommended version`,
	);
}

console.log(`Node.js toolchain is aligned on ${pinnedVersion}`);

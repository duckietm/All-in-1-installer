const fs = require("node:fs");
const { parse, printParseErrorCode } = require("jsonc-parser");

const exampleFile = process.argv[2];
const targetFile = process.argv[3];

if (!exampleFile || !targetFile) {
	process.exit(1);
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Merge the upstream example into the live config with strict "add missing,
// never remove or overwrite" semantics so hotel configs survive every update:
//   - every key already present in the live config is PRESERVED (scalars,
//     arrays and nested objects always win over the upstream example),
//   - nested objects are merged recursively so upstream-only sub-keys are
//     added while the hotel's own sub-keys stay untouched,
//   - keys that do not exist in the live config yet are ADDED from the example,
//   - a source object NEVER replaces an existing scalar/array (would corrupt).
function deepMerge(target, source) {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (isPlainObject(source[key])) {
			if (isPlainObject(result[key])) {
				result[key] = deepMerge(result[key], source[key]);
			} else if (!(key in result)) {
				result[key] = deepMerge({}, source[key]);
			}
			// Else: live value is a scalar/array/null -> keep it untouched.
		} else if (!(key in result)) {
			result[key] = source[key];
		}
	}
	return result;
}

function parseJsonc(file) {
	if (!fs.existsSync(file)) {
		return undefined;
	}
	const content = fs.readFileSync(file, "utf-8");
	const errors = [];
	const value = parse(content, errors, {
		allowTrailingComma: true,
		allowEmptyContent: true,
	});
	if (errors.length > 0) {
		console.error(
			`[merge-config] parse error in ${file}: ${errors
				.map((e) => printParseErrorCode(e.error))
				.join(", ")}`,
		);
		return undefined;
	}
	return value;
}

let example;
try {
	example = parseJsonc(exampleFile);
} catch {
	process.exit(1);
}

if (example === undefined) {
	process.exit(1);
}

let current = {};
try {
	const parsed = parseJsonc(targetFile);
	if (parsed !== undefined && parsed !== null) {
		current = parsed;
	}
} catch {
	current = {};
}

const merged = deepMerge(current, example);

// Sanity: the merged result must stay an object and the written file must be
// re-parseable. If anything goes wrong we keep the live file untouched rather
// than shipping a corrupted config to the client.
if (merged === undefined || merged === null || typeof merged !== "object") {
	process.stderr.write(
		`[merge-config] refused to write non-object result for ${targetFile}\n`,
	);
	process.exit(1);
}

// Verify the result parses round-trip before overwriting the live config.
const serialized = `${JSON.stringify(merged, null, 4)}\n`;
let check;
try {
	check = parse(serialized, [], {
		allowTrailingComma: true,
		allowEmptyContent: true,
	});
} catch {
	check = undefined;
}
if (!check || typeof check !== "object" || Array.isArray(check)) {
	process.stderr.write(
		`[merge-config] refused to write unparseable result for ${targetFile}\n`,
	);
	process.exit(1);
}
fs.writeFileSync(targetFile, serialized);

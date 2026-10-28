import fs from "node:fs";
import path from "node:path";

const messagesDir = "/var/www/atom-nexst/src/messages";
const enPath = path.join(messagesDir, "en.json");
const enData = JSON.parse(fs.readFileSync(enPath, "utf8"));

function deepMerge(target, source) {
	for (const key of Object.keys(source)) {
		if (
			source[key] &&
			typeof source[key] === "object" &&
			!Array.isArray(source[key])
		) {
			if (
				!target[key] ||
				typeof target[key] !== "object" ||
				Array.isArray(target[key])
			) {
				target[key] = {};
			}
			deepMerge(target[key], source[key]);
		} else {
			if (!(key in target)) {
				target[key] = source[key];
			}
		}
	}
	return target;
}

const files = fs
	.readdirSync(messagesDir)
	.filter((f) => f.endsWith(".json") && f !== "en.json");

for (const file of files) {
	const filePath = path.join(messagesDir, file);
	try {
		const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
		deepMerge(data, enData);
		fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
		console.log(`Synced ${file}`);
	} catch (err) {
		console.error(`Error syncing ${file}:`, err);
	}
}
console.log("Translation sync complete!");

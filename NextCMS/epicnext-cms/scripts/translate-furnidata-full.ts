import "./load-env";
import { buildLocalizedFurniDataFiles } from "../src/lib/services/furni-data-i18n";

async function main() {
	const args = process.argv.slice(2);
	const maxPerLang = args.includes("--full")
		? undefined
		: args.includes("--limit")
			? parseInt(args[args.indexOf("--limit") + 1] || "2000", 10)
			: 1500;
	const full = args.includes("--full");
	console.log(
		`[translate-furnidata] Starting ${full ? "FULL" : `limited ${maxPerLang} per lang`} build...`,
	);
	const start = Date.now();
	try {
		const results = await buildLocalizedFurniDataFiles();
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);
		console.log(`[translate-furnidata] Done in ${elapsed}s`);
		for (const r of results) {
			console.log(
				`  ${r.lang} (${r.hotel}): ${r.translatedRoom + r.translatedWall}/${r.total} translated -> ${r.file} ${r.ok ? "OK" : `FAIL ${r.error}`}`,
			);
		}
	} catch (e) {
		console.error("Failed", e);
		process.exit(1);
	}
}
main();

import "./load-env";
import { buildLocalizedFurniDataFiles } from "../src/lib/services/furni-data-i18n";

async function main() {
	const args = process.argv.slice(2);
	const full = args.includes("--full");
	const maxPerLang = full
		? undefined
		: args.includes("--limit")
			? parseInt(args[args.indexOf("--limit") + 1] || "2000", 10)
			: 1500;
	const concurrency = args.includes("--concurrency")
		? parseInt(args[args.indexOf("--concurrency") + 1] || "6", 10)
		: 6;

	console.log(
		`[build-languages] Starting ${full ? "FULL" : `limited ${maxPerLang} per lang`} build (concurrency ${concurrency})...`,
	);
	const start = Date.now();
	try {
		const results = await buildLocalizedFurniDataFiles();
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);
		console.log(`[build-languages] Done in ${elapsed}s`);
		for (const r of results) {
			const totalTranslated = r.translatedRoom + r.translatedWall;
			const pct =
				r.total > 0 ? ((totalTranslated / r.total) * 100).toFixed(1) : "0.0";
			console.log(
				`  ${r.lang} (${r.hotel}): ${totalTranslated}/${r.total} translated (${pct}%) -> ${r.file} ${r.ok ? "OK" : `FAIL ${r.error}`}`,
			);
		}
		process.exit(0);
	} catch (e) {
		console.error("[build-languages] Failed:", e);
		process.exit(1);
	}
}

main();

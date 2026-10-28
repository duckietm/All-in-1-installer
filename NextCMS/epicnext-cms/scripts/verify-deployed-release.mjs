import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function verifyDeployedRelease(
	url,
	expected,
	{ attempts = 30, interval = 3000, report = console.error } = {},
) {
	if (!/^[a-f0-9]{40}$/.test(expected))
		throw new Error("Expected a full Git commit SHA");
	const target = new URL(url);
	if (!["http:", "https:"].includes(target.protocol))
		throw new Error("Expected an HTTP(S) health URL");
	for (let attempt = 1; attempt <= attempts; attempt++) {
		let observed;
		try {
			target.searchParams.set("expectedRelease", expected);
			target.searchParams.set("probe", String(attempt));
			const response = await fetch(target, {
				cache: "no-store",
				redirect: "error",
				headers: { "Cache-Control": "no-cache" },
				signal: AbortSignal.timeout(5000),
			});
			const body = await response.json();
			observed = {
				http: response.status,
				status: body.status ?? null,
				database: body.database ?? null,
				release: body.release ?? null,
			};
			if (response.ok && body.database === true && body.release === expected)
				return;
		} catch (error) {
			observed = {
				error: error instanceof Error ? error.message : String(error),
			};
		}
		report(JSON.stringify({ attempt, attempts, expected, observed }));
		if (attempt < attempts) await delay(interval);
	}
	throw new Error(
		"Expected release never became healthy. Check container startup, port ownership and the HTTP destination.",
	);
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		await verifyDeployedRelease(process.argv[2], process.argv[3]);
		console.log(`HTTP release verified: ${process.argv[3]}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

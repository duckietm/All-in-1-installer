// Metadata handlers can resolve runtime settings without a working application DB.
export async function verifyRuntimeMetadata(base, hotel) {
	const manifest = await fetch(`${base}/manifest.webmanifest`, {
		signal: AbortSignal.timeout(15000),
	});
	if (!manifest.ok)
		throw new Error(`${hotel}: manifest HTTP ${manifest.status}`);
	if ((await manifest.json()).name !== `Fixture ${hotel}`)
		throw new Error(`${hotel}: manifest contains build-time settings`);
	for (const path of ["/robots.txt", "/sitemap.xml"]) {
		const response = await fetch(base + path, {
			signal: AbortSignal.timeout(15000),
		});
		if (!response.ok)
			throw new Error(`${hotel}: ${path} HTTP ${response.status}`);
		if (!(await response.text()).includes(base))
			throw new Error(`${hotel}: ${path} contains build-time domain`);
	}
}

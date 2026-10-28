import { afterAll } from "vitest";

// 1. Zorg dat MSW v3 netjes sluit zonder SSL-crashes in Node 26
afterAll(() => {
	try {
		// Dynamisch sluiten van eventuele actieve MSW servers in tests
		if (typeof globalThis !== "undefined") {
			// @ts-expect-error
			globalThis.mswServer?.close();
		}
	} catch (_e) {}
});

// 2. Globale polyfill voor fetch-fouten indien nodig
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	try {
		return await originalFetch(input, init);
	} catch (error: unknown) {
		if (
			error instanceof Error &&
			error.message.includes("ERR_SSL_TLSV1_UNRECOGNIZED_NAME")
		) {
			// Zet de SSL-fout om in een normaal te catchen HTTP-antwoord voor MSW
			return new Response(
				JSON.stringify({ message: "History unavailable", status: 403 }),
				{ status: 403 },
			);
		}
		throw error;
	}
};

import { readSseStream } from "@/lib/sse-client";

interface ImportResponse {
	status: number;
	data: Record<string, unknown>;
}
export async function readImportResponse(
	response: Response,
): Promise<ImportResponse> {
	if (
		response.ok &&
		response.headers.get("content-type")?.includes("text/event-stream")
	) {
		if (!response.body)
			throw Error(
				"Import response is empty. Check the furniture status before retrying.",
			);
		let result: ImportResponse | undefined;
		await readSseStream(response.body, (event) => {
			if (
				event.type === "result" &&
				typeof event.status === "number" &&
				event.data &&
				typeof event.data === "object"
			)
				result = {
					status: event.status,
					data: event.data as Record<string, unknown>,
				};
		});
		if (!result)
			throw Error(
				"Import connection ended before confirmation. Some changes may already be saved. Check the furniture status before retrying.",
			);
		return result;
	}
	const text = await response.text();
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(text);
	} catch {
		const reason = [502, 503, 504, 524].includes(response.status)
			? "Server or proxy unavailable, or request timed out"
			: "Server returned an unexpected response";
		throw Error(
			`${reason} (HTTP ${response.status}). Check the furniture status before retrying.`,
		);
	}
	if (!data || typeof data !== "object")
		throw Error(`Invalid import response (HTTP ${response.status}).`);
	return { status: response.status, data };
}

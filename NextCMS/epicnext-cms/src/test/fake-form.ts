export function fakeForm(
	data: Record<string, string | null | undefined>,
): FormData {
	return {
		get: (key: string) => data[key] ?? null,
	} as unknown as FormData;
}

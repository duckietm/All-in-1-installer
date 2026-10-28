import { positiveBigInt } from "@/lib/api";

export function formPositiveBigInt(
	formData: FormData,
	field: string,
): bigint | null {
	const value = formData.get(field);
	return typeof value === "string" ? positiveBigInt(value.trim()) : null;
}

/** Only server-issued UUID references can become diagnostic/navigation targets. */
export function isDeliveryReference(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
			value,
		)
	);
}
export function deliveryDiagnosticId(value: string | null): string | null {
	const prefix = "Diagnostic reference: ";
	const id = value?.startsWith(prefix) ? value.slice(prefix.length) : null;
	return isDeliveryReference(id) ? id : null;
}
export function deliveryDiagnosticLink(errorId: unknown): string {
	return isDeliveryReference(errorId)
		? `/admin/devops/cms-errors?q=${encodeURIComponent(errorId)}`
		: "/admin/devops/installation";
}

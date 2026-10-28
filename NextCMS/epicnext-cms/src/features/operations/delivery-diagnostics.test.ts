// @ts-nocheck
import { expect, it } from "vitest";
import {
	deliveryDiagnosticId,
	deliveryDiagnosticLink,
} from "./delivery-diagnostics";

it("uses only an exact server-issued reference for a diagnostic link", () => {
	const id = "4f3df172-f1ca-4c26-a23e-cb4e6c13e9f2";
	expect(deliveryDiagnosticId(`Diagnostic reference: ${id}`)).toBe(id);
	expect(deliveryDiagnosticLink(id)).toBe(`/admin/devops/cms-errors?q=${id}`);
	for (const input of [
		null,
		"",
		"private SQL",
		"Diagnostic reference: ../settings",
		`Diagnostic reference: ${id}?secret=value`,
		`Diagnostic reference: ${id}\n`,
	]) {
		expect(deliveryDiagnosticId(input)).toBeNull();
		expect(deliveryDiagnosticLink(input)).toBe("/admin/devops/installation");
	}
});

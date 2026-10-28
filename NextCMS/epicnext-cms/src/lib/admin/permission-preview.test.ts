import { expect, it } from "vitest";
import { PERMS } from "../permission-slugs";
import { previewRoleAccess } from "./permission-preview";

it("requires dashboard access before reporting a module usable", () => {
	const p = previewRoleAccess([PERMS.USERS_VIEW], false);
	expect(p.canEnter).toBe(false);
	expect(p.sections.find((s) => s.href === "/admin/users")?.allowed).toBe(
		false,
	);
});
it("shows grants and denies without combining another role", () => {
	const p = previewRoleAccess([PERMS.ADMIN_DASHBOARD, PERMS.USERS_VIEW], false);
	expect(p.sections.find((s) => s.href === "/admin/users")?.allowed).toBe(true);
	expect(p.actions.find((s) => s.slug === PERMS.USERS_EDIT)?.granted).toBe(
		false,
	);
});
it("applies the existing highest-rank override", () => {
	const p = previewRoleAccess([], true);
	expect(p.canEnter).toBe(true);
	expect(p.actions.every((a) => a.granted)).toBe(true);
});

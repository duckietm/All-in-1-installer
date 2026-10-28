import { describe, expect, it, vi } from "vitest";
import type { PermissionSet } from "@/types/admin";
import {
	createHousekeepingCapabilityContext,
	satisfiesCapability,
} from "./capability-context";
import {
	allCapabilities,
	anyCapability,
	type HousekeepingActor,
} from "./contracts";

const actor: HousekeepingActor = {
	id: 42,
	username: "operator",
	rank: 7,
};

const permissionSet = (
	slugs: readonly string[],
	isSuperAdmin = false,
): PermissionSet => {
	const granted = new Set(slugs);
	const has = (slug: string) => isSuperAdmin || granted.has(slug);

	return {
		isSuperAdmin,
		has,
		hasAny: (...requested) => requested.some(has),
		hasAll: (...requested) => requested.every(has),
	};
};

describe("housekeeping capability context", () => {
	it("evaluates any and all requirements from effective permission methods", () => {
		const context = createHousekeepingCapabilityContext(
			actor,
			permissionSet(["admin.users.view", "admin.tickets.view"]),
		);

		expect(
			satisfiesCapability(
				context,
				anyCapability("admin.users.view", "admin.logs.view"),
			),
		).toBe(true);
		expect(
			satisfiesCapability(
				context,
				allCapabilities("admin.users.view", "admin.logs.view"),
			),
		).toBe(false);
	});

	it("keeps the super administrator bypass explicit", () => {
		const context = createHousekeepingCapabilityContext(
			actor,
			permissionSet([], true),
		);

		expect(context.isSuperAdmin).toBe(true);
		expect(context.has("unknown.future.slug")).toBe(true);
		expect(
			satisfiesCapability(context, allCapabilities("unknown.future.slug")),
		).toBe(true);
	});

	it("bypasses meaningful requirements without consulting permission methods", () => {
		const permissions: PermissionSet = {
			isSuperAdmin: true,
			has: vi.fn(() => false),
			hasAny: vi.fn(() => false),
			hasAll: vi.fn(() => false),
		};
		const context = createHousekeepingCapabilityContext(actor, permissions);

		expect(
			satisfiesCapability(
				context,
				anyCapability("admin.users.view", "admin.logs.view"),
			),
		).toBe(true);
		expect(
			satisfiesCapability(
				context,
				allCapabilities("admin.users.view", "admin.logs.view"),
			),
		).toBe(true);
		expect(permissions.has).not.toHaveBeenCalled();
		expect(permissions.hasAny).not.toHaveBeenCalled();
		expect(permissions.hasAll).not.toHaveBeenCalled();
	});

	it("delegates capability checks without applying rank logic", () => {
		const permissions: PermissionSet = {
			isSuperAdmin: false,
			has: vi.fn(() => false),
			hasAny: vi.fn(() => true),
			hasAll: vi.fn(() => false),
		};
		const context = createHousekeepingCapabilityContext(
			{ ...actor, rank: 0 },
			permissions,
		);

		expect(
			satisfiesCapability(context, anyCapability("admin.users.view")),
		).toBe(true);
		expect(
			satisfiesCapability(context, allCapabilities("admin.users.view")),
		).toBe(false);
		expect(permissions.hasAny).toHaveBeenCalledWith("admin.users.view");
		expect(permissions.hasAll).toHaveBeenCalledWith("admin.users.view");
	});
});

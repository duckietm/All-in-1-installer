import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cleanup = vi.hoisted(() => [] as Array<() => void>);
vi.mock("react", () => ({
	useRef: (value: unknown) => ({ current: value }),
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => (() => void) | undefined) => {
		const dispose = effect();
		if (dispose) cleanup.push(dispose);
	},
}));

import {
	confirmUnsavedNavigation,
	useUnsavedChanges,
} from "./use-unsaved-changes";

let confirm: ReturnType<typeof vi.fn>;
beforeEach(() => {
	confirm = vi.fn().mockReturnValue(false);
	vi.stubGlobal("window", Object.assign(new EventTarget(), { confirm }));
	vi.stubGlobal("document", new EventTarget());
	vi.stubGlobal("location", new URL("https://hotel.test/admin/editor"));
});
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
	vi.unstubAllGlobals();
});
it("asks once for several dirty forms and allows clean navigation", () => {
	useUnsavedChanges(true, "Discard changes?");
	useUnsavedChanges(true, "Other changes?");
	expect(confirmUnsavedNavigation()).toBe(false);
	expect(confirm).toHaveBeenCalledTimes(1);
	confirm.mockReturnValue(true);
	expect(confirmUnsavedNavigation()).toBe(true);
});
it("removes unmounted forms from navigation protection", () => {
	useUnsavedChanges(true, "Discard changes?");
	for (const dispose of cleanup.splice(0)) dispose();
	expect(confirmUnsavedNavigation()).toBe(true);
	expect(confirm).not.toHaveBeenCalled();
});
it("protects explicit close but clears synchronously after successful save", () => {
	const guard = useUnsavedChanges(true, "Discard changes?");
	expect(guard.confirmLeave()).toBe(false);
	guard.markSaved();
	expect(guard.confirmLeave()).toBe(true);
	expect(confirmUnsavedNavigation()).toBe(true);
	expect(confirm).toHaveBeenCalledTimes(1);
});
it("keeps reload protected after cancelled navigation", () => {
	useUnsavedChanges(true, "Discard changes?");
	confirmUnsavedNavigation();
	const event = new Event("beforeunload", { cancelable: true });
	window.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(true);
});

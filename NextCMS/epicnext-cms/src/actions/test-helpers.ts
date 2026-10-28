import { vi } from "vitest";

export const createMockDb = () => ({
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
	select: vi.fn(),
});

export const createMockAuth = () => ({
	auth: vi.fn(),
	handlers: {},
	signOut: vi.fn(),
});

export const createMockRcon = () => ({
	disconnectUser: vi.fn(),
	giveBadge: vi.fn(),
	removeBadge: vi.fn(),
	alertUser: vi.fn(),
	muteUser: vi.fn(),
	unmuteUser: vi.fn(),
	giveCredits: vi.fn(),
});

export const createMockLogStaffActivity = () => vi.fn();

export const createMockRevalidatePath = () => vi.fn();

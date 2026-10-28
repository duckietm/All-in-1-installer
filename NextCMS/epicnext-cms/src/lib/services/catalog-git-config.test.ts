// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	catalogGitEnvironment,
	decryptCatalogToken,
	publicCatalogConfig,
	validateCatalogConfig,
} from "./catalog-git-config";

const input = {
	enabled: true,
	remote: "https://gitlab.epicnabbo.nl/remco/Epicnabbo-Catalogus-Updated-Daily",
	branch: "Beta-3",
	username: "remco",
	token: "private-token",
};
describe("Gitea catalog configuration", () => {
	beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-auth-secret"));
	afterEach(() => vi.unstubAllEnvs());
	it("supports self-hosted Gitea and encrypts the token", () => {
		const config = validateCatalogConfig(input, null);
		expect(config.remote).toBe(`${input.remote}.git`);
		expect(config.encryptedToken).not.toContain(input.token);
		expect(decryptCatalogToken(config.encryptedToken)).toBe(input.token);
		expect(JSON.stringify(publicCatalogConfig(config))).not.toContain(
			input.token,
		);
		expect(publicCatalogConfig(config).provider).toBe("gitea");
	});
	it("preserves saved token only for the same repository and user", () => {
		const previous = validateCatalogConfig(input, null);
		expect(
			validateCatalogConfig({ ...input, token: "" }, previous).encryptedToken,
		).toBe(previous.encryptedToken);
		expect(() =>
			validateCatalogConfig(
				{ ...input, token: "", remote: "https://other.example/user/repo" },
				previous,
			),
		).toThrow();
	});
	it("rejects embedded credentials and unsafe branches", () => {
		expect(() =>
			validateCatalogConfig(
				{ ...input, remote: "https://user:secret@host/user/repo" },
				null,
			),
		).toThrow();
		for (const branch of [
			"--help",
			"main..evil",
			"../branch",
			"a.lock",
			"a\\b",
		])
			expect(() => validateCatalogConfig({ ...input, branch }, null)).toThrow();
	});
	it("supplies credentials through environment and disables redirects", () => {
		const config = validateCatalogConfig(input, null);
		const env = catalogGitEnvironment(config);
		expect(env.GIT_CONFIG_KEY_0).toBe(
			"http.https://gitlab.epicnabbo.nl/.extraHeader",
		);
		expect(env.GIT_CONFIG_VALUE_1).toBe("false");
	});
});

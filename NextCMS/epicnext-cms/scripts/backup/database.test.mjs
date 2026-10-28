import { expect, it } from "vitest";
import {
	credentialOptions,
	dockerEnvironment,
	validateDatabase,
} from "./database.mjs";

it("quotes credentials without permitting option-file injection", () => {
	const config = {
		host: "127.0.0.1",
		port: 3306,
		user: "backup",
		password: 'quote"slash\\secret',
		database: "cms",
	};
	expect(credentialOptions(config)).toContain(
		'password="quote\\"slash\\\\secret"',
	);
	expect(() =>
		credentialOptions({ ...config, password: "secret\n[client]" }),
	).toThrow();
	expect(() => validateDatabase({ ...config, database: "mysql" })).toThrow();
	expect(() =>
		validateDatabase({ ...config, database: "cms; DROP DATABASE other" }),
	).toThrow();
});

it("passes only explicit Docker runtime variables to subprocesses", () => {
	expect(
		dockerEnvironment({
			PATH: "/bin",
			DOCKER_HOST: "unix:///run/docker.sock",
			DATABASE_URL: "private",
			MARIADB_PWD: "secret",
			NODE_OPTIONS: "--inspect",
			HOME: "/operator",
		}),
	).toEqual({
		PATH: "/bin",
		DOCKER_HOST: "unix:///run/docker.sock",
		HOME: "/operator",
	});
});

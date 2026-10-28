import { describe, expect, it } from "vitest";
import { mysqlConnectionUrl } from "./db-url";

describe("mysqlConnectionUrl", () => {
	it("removes Prisma-only pool options before passing the URL to MySQL2", () => {
		const result = mysqlConnectionUrl(
			"mysql://user:pass@localhost:3306/cms?connection_limit=20&pool_timeout=30&charset=utf8mb4",
		);
		expect(result).not.toContain("connection_limit");
		expect(result).not.toContain("pool_timeout");
		expect(result).toContain("charset=utf8mb4");
	});
});

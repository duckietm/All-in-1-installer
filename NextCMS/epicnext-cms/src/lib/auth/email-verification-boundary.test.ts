import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { expect, it } from "vitest";

it("keeps verification token minting and sending out of public server action exports", () => {
	const forbidden = [
		"verificationToken",
		"isValidVerificationToken",
		"sendVerification",
	];
	const exposed: string[] = [];
	for (const file of readdirSync("src/actions").filter(
		(file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
	)) {
		const ast = parse(readFileSync(path.join("src/actions", file), "utf8"), {
			sourceType: "module",
			plugins: ["typescript"],
		});
		if (!ast.program.directives.some((d) => d.value.value === "use server"))
			continue;
		for (const item of ast.program.body) {
			if (item.type !== "ExportNamedDeclaration") continue;
			if (
				item.declaration?.type === "FunctionDeclaration" &&
				forbidden.includes(item.declaration.id?.name ?? "")
			)
				exposed.push(`${file}:${item.declaration.id?.name}`);
			for (const spec of item.specifiers) {
				const name =
					spec.exported.type === "Identifier"
						? spec.exported.name
						: spec.exported.value;
				if (forbidden.includes(name)) exposed.push(`${file}:${name}`);
			}
		}
	}
	expect(exposed).toEqual([]);
});

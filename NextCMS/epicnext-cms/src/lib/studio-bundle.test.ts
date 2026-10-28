// @ts-nocheck
import path from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";

async function bundleInputs(entry: string) {
	const result = await build({
		entryPoints: [entry],
		bundle: true,
		splitting: true,
		format: "esm",
		write: false,
		outdir: "storage/bundle-check",
		metafile: true,
		packages: "external",
		alias: { "@": path.resolve("src") },
		plugins: [
			{
				name: "server-action-boundary",
				setup(builder) {
					builder.onResolve({ filter: /^@\/actions\// }, ({ path }) => ({
						path,
						external: true,
					}));
				},
			},
		],
	});
	const outputs = result.metafile.outputs;
	const start = Object.keys(outputs).find(
		(key) => outputs[key].entryPoint === entry,
	);
	expect(start).toBeDefined();
	const seen = new Set<string>();
	function visit(key: string) {
		if (seen.has(key)) return;
		seen.add(key);
		for (const dependency of outputs[key].imports) {
			if (dependency.kind !== "dynamic-import" && !dependency.external)
				visit(dependency.path);
		}
	}
	if (!start) throw new Error("Missing editor entry bundle");
	visit(start);
	const initialInputs = new Set(
		[...seen].flatMap((key) => Object.keys(outputs[key].inputs)),
	);
	return { initialInputs, inputs: Object.keys(result.metafile.inputs) };
}

it("keeps scale preview and generation outside the initial Nitro editor bundle", async () => {
	const { initialInputs, inputs } = await bundleInputs(
		"src/app/admin/import/furni/nitro-editor-dialog.tsx",
	);
	for (const name of [
		"nitro-quality-panel.tsx",
		"nitro-scale32-generator.tsx",
	]) {
		expect(inputs.some((input) => input.endsWith(name))).toBe(true);
		expect([...initialInputs].some((input) => input.endsWith(name))).toBe(
			false,
		);
	}
}, 30_000);

it("loads import organization and its icon picker only when requested in Studio", async () => {
	const { initialInputs, inputs } = await bundleInputs(
		"src/app/admin/studio/studio-layout-client.tsx",
	);
	for (const name of ["organize-imports-dialog.tsx", "icon-picker.tsx"]) {
		expect(inputs.some((input) => input.endsWith(name))).toBe(true);
		expect([...initialInputs].some((input) => input.endsWith(name))).toBe(
			false,
		);
	}
}, 30_000);

import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = path.dirname(require.resolve("tinymce/package.json"));
const target = path.resolve("public/vendor/tinymce");
await mkdir(target, { recursive: true });
for (const name of [
	"tinymce.min.js",
	"icons",
	"models",
	"plugins",
	"skins",
	"themes",
	"license.md",
	"notices.txt",
]) {
	await cp(path.join(source, name), path.join(target, name), {
		recursive: true,
	});
}

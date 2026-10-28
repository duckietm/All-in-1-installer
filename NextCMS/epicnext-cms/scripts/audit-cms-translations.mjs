import fs from "node:fs";
import path from "node:path";
import * as babel from "@babel/parser";
import { parse } from "@formatjs/icu-messageformat-parser";

const flat = (obj, p = "", r = {}) => {
	for (const [k, v] of Object.entries(obj)) {
		const key = p ? `${p}.${k}` : k;
		if (v && typeof v === "object") flat(v, key, r);
		else r[key] = v;
	}
	return r;
};
const messages = Object.fromEntries(
	fs
		.readdirSync("src/messages")
		.filter((n) => n.endsWith(".json"))
		.map((n) => [
			n.slice(0, -5),
			flat(JSON.parse(fs.readFileSync(`src/messages/${n}`, "utf8"))),
		]),
);
const base = messages.en,
	invalid = [],
	mismatches = [];
function vars(ast, r = new Set()) {
	for (const n of ast) {
		if ([1, 2, 3, 4, 5, 6, 8].includes(n.type)) r.add(n.value);
		if (n.options) for (const o of Object.values(n.options)) vars(o.value, r);
		if (n.children) vars(n.children, r);
	}
	return [...r].sort().join(",");
}
const signatures = {};
for (const [k, v] of Object.entries(base)) {
	try {
		signatures[k] = vars(parse(v));
	} catch {}
}
const locales = Object.entries(messages).map(([locale, m]) => {
	for (const [k, v] of Object.entries(m)) {
		try {
			const sig = vars(parse(v));
			if (k in signatures && sig !== signatures[k])
				mismatches.push({
					locale,
					key: k,
					expected: signatures[k],
					actual: sig,
					value: v,
				});
		} catch (e) {
			invalid.push({ locale, key: k, value: v, error: e.message });
		}
	}
	return {
		locale,
		total: Object.keys(m).length,
		missing: Object.keys(base).filter((k) => !(k in m)).length,
		empty: Object.values(m).filter((v) => !v?.trim()).length,
		sameAsEnglish: Object.keys(base).filter((k) => m[k] === base[k]).length,
	};
});
const missingCalls = [],
	hardcoded = [],
	unparsedFiles = [];
function walk(n, fn) {
	if (!n || typeof n !== "object") return;
	fn(n);
	for (const [k, v] of Object.entries(n)) {
		if (k === "loc" || k === "extra") continue;
		if (Array.isArray(v))
			v.forEach((x) => {
				walk(x, fn);
			});
		else if (v && typeof v === "object") walk(v, fn);
	}
}
for (const f of fs
	.readdirSync("src", { recursive: true })
	.filter((f) => /\.(tsx|ts)$/.test(f) && !f.includes(".test."))) {
	let ast;
	try {
		ast = babel.parse(fs.readFileSync(path.join("src", f), "utf8"), {
			sourceType: "module",
			plugins: ["typescript", "jsx"],
		});
	} catch (error) {
		unparsedFiles.push({ file: f, error: error.message });
		continue;
	}
	const bindings = {};
	walk(ast, (n) => {
		if (n.type === "VariableDeclarator" && n.id.type === "Identifier") {
			let c = n.init;
			if (c?.type === "AwaitExpression") c = c.argument;
			if (
				c?.type === "CallExpression" &&
				["useTranslations", "getTranslations"].includes(c.callee.name)
			) {
				const arg = c.arguments[0];
				const ns =
					arg?.type === "StringLiteral"
						? arg.value
						: arg?.type === "ObjectExpression"
							? arg.properties.find((p) => p.key?.name === "namespace")?.value
									?.value
							: arg
								? null
								: "";
				if (ns !== null) {
					bindings[n.id.name] ??= new Set();
					bindings[n.id.name].add(ns);
				}
			}
		}
	});
	walk(ast, (n) => {
		if (n.type === "CallExpression") {
			const name = n.callee.name ?? n.callee.object?.name;
			const ns = bindings[name];
			const k = n.arguments[0];
			if (ns?.size === 1 && k?.type === "StringLiteral") {
				const full = [...ns][0] ? `${[...ns][0]}.${k.value}` : k.value;
				if (
					!(full in base) &&
					!Object.keys(base).some((b) => b.startsWith(`${full}.`))
				)
					missingCalls.push({ file: f, line: n.loc.start.line, key: full });
			}
		}
		if (n.type === "JSXText" && /[A-Za-z]{3}/.test(n.value.trim()))
			hardcoded.push({
				file: f,
				line: n.loc.start.line,
				text: n.value.trim().replace(/\s+/g, " "),
			});
	});
}
const result = {
	locales,
	invalid,
	mismatches,
	missingCalls,
	hardcoded,
	unparsedFiles,
};
if (process.argv.includes("--json"))
	console.log(JSON.stringify(result, null, 2));
else {
	console.table(locales);
	console.log(
		"Invalid ICU:",
		invalid.length,
		"Variable mismatches:",
		mismatches.length,
		"Missing static message references:",
		missingCalls.length,
	);
	console.log(
		"Literal JSX text candidates requiring editorial review:",
		hardcoded.length,
	);
	console.log(
		"Coverage checks static translator namespaces and literal keys; dynamic keys and semantic translation quality require review.",
	);
	if (
		invalid.length ||
		mismatches.length ||
		missingCalls.length ||
		unparsedFiles.length
	)
		console.log(
			JSON.stringify(
				{ invalid, mismatches, missingCalls, unparsedFiles },
				null,
				2,
			),
		);
}
if (
	process.argv.includes("--check") &&
	(invalid.length ||
		mismatches.length ||
		missingCalls.length ||
		unparsedFiles.length ||
		locales.some((locale) => locale.empty > 0))
)
	process.exitCode = 1;

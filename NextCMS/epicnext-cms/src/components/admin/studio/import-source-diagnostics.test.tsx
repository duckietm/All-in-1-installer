import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ImportSourceDiagnostics } from "./import-source-diagnostics";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string, args?: Record<string, unknown>) =>
		`${key}${args?.status ?? ""}`,
}));
it("shows filenames, attempted addresses and distinct reasons inline", () => {
	const html = renderToStaticMarkup(
		<ImportSourceDiagnostics
			check={{
				classname: "chair",
				revision: 1,
				state: "missing",
				alternatives: [],
				attempts: [
					{
						file: "chair.swf",
						url: "https://source.test/1/chair.swf",
						state: "missing",
						reason: "http",
						status: 404,
					},
					{
						file: "chair.nitro",
						url: "https://source.test/chair.nitro",
						state: "unknown",
						reason: "timeout",
					},
				],
			}}
		/>,
	);
	expect(html).toContain("chair.swf");
	expect(html).toContain("http404");
	expect(html).toContain("timeout");
	expect(html).toContain("https://source.test/1/chair.swf");
	expect(html).not.toContain("href=");
});
it("does not invent diagnostics for earlier responses", () => {
	expect(
		renderToStaticMarkup(
			<ImportSourceDiagnostics
				check={{
					classname: "chair",
					revision: 1,
					state: "missing",
					alternatives: [],
				}}
			/>,
		),
	).toBe("");
});

import path from "node:path";

export function getRuntimePath(...segments: string[]): string {
	const resolvePath = new Function("p", "segs", "return p.join(...segs)");
	return resolvePath(path, segments);
}

export function getRuntimeResolve(...segments: string[]): string {
	const resolvePath = new Function("p", "segs", "return p.resolve(...segs)");
	return resolvePath(path, segments);
}

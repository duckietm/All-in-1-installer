import { promises as fs } from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuntimePath } from "@/lib/utils/runtime-path";
import {
	readGamedataJson,
	withGamedataLock,
	writeGamedataJsonAtomic,
} from "./gamedata-json";

let dir: string;
let file: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(getRuntimePath(os.tmpdir(), "gamedata-"));
	file = getRuntimePath(dir, "EffectMap.json");
	await fs.writeFile(
		file,
		JSON.stringify({ effects: [{ id: "1", lib: "A" }] }),
	);
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe("import/core/gamedata-json", () => {
	it("reads parsed JSON", async () => {
		const data = await readGamedataJson<{ effects: unknown[] }>(file);
		expect(data.effects).toHaveLength(1);
	});

	it("writes atomically (round-trips)", async () => {
		await writeGamedataJsonAtomic(file, { effects: [{ id: "9", lib: "Z" }] });
		const data = await readGamedataJson<{ effects: Array<{ id: string }> }>(
			file,
		);
		expect(data.effects[0].id).toBe("9");
	});

	it("serializes concurrent writers (no lost update)", async () => {
		const bump = (n: number) =>
			withGamedataLock(file, async () => {
				const d = await readGamedataJson<{ effects: unknown[] }>(file);
				d.effects.push({ id: String(n), lib: `L${n}` });
				await writeGamedataJsonAtomic(file, d);
			});
		await Promise.all([bump(2), bump(3), bump(4)]);
		const d = await readGamedataJson<{ effects: unknown[] }>(file);
		expect(d.effects).toHaveLength(4); // 1 seed + 3 appended, none lost
	});
});

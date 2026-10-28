// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	detectSoundtrackKind,
	parseTrackSamples,
	parseTraxChannels,
	TRAX_TICK_SECONDS,
} from "./trax-format";

describe("parseTraxChannels", () => {
	it("returns [] for empty or null tracks", () => {
		expect(parseTraxChannels("")).toEqual([]);
		expect(parseTraxChannels(null)).toEqual([]);
		expect(parseTraxChannels(undefined)).toEqual([]);
	});

	it("parses per-channel event lists", () => {
		const channels = parseTraxChannels("1:10,2;0,1:2:5,3");
		expect(channels).toEqual([
			{
				channel: 1,
				events: [
					{ sampleId: 10, ticks: 2 },
					{ sampleId: 0, ticks: 1 },
				],
			},
			{ channel: 2, events: [{ sampleId: 5, ticks: 3 }] },
		]);
	});

	it("skips malformed event pairs", () => {
		const channels = parseTraxChannels("1:10,2;garbage");
		expect(channels).toEqual([
			{ channel: 1, events: [{ sampleId: 10, ticks: 2 }] },
		]);
	});

	it("drops channels with no valid events", () => {
		expect(parseTraxChannels("1:junk")).toEqual([]);
	});
});

describe("parseTrackSamples", () => {
	it("collects unique non-zero sample ids, sorted", () => {
		expect(parseTrackSamples("1:5,1;0,2:2:3,4;5,2")).toEqual([3, 5]);
	});
	it("returns [] for silence-only tracks", () => {
		expect(parseTrackSamples("1:0,3")).toEqual([]);
	});
	it("returns [] for empty or unparseable tracks", () => {
		expect(parseTrackSamples("")).toEqual([]);
		expect(parseTrackSamples(null)).toEqual([]);
	});
});

describe("detectSoundtrackKind", () => {
	it("classifies a single-sample song as 'single'", () => {
		expect(detectSoundtrackKind("1:0,24")).toBe("single");
		expect(detectSoundtrackKind("")).toBe("single");
	});
	it("classifies multi-sample tracks as 'composition'", () => {
		expect(detectSoundtrackKind("1:10,2;20,3")).toBe("composition");
	});
});

describe("TRAX_TICK_SECONDS", () => {
	it("is 2 seconds per tick", () => {
		expect(TRAX_TICK_SECONDS).toBe(2);
	});
});

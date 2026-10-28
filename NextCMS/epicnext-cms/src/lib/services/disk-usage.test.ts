// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	DISK_THRESHOLDS,
	diskLevel,
	formatBytes,
	parseDfOutput,
} from "./disk-usage";

const SAMPLE = `Filesystem      1-blocks        Used   Available Capacity Mounted on
/dev/vda1    10240000000   5120000000    5120000000      50% /
/dev/vda2    20480000000  19456000000    1024000000      95% /var/www
overlay      10240000000   5120000000    5120000000      50% /home/me
tmpfs        10240000000   5120000000    5120000000      50% /dev/shm
/dev/vdb1    51200000000  43929600000    7270400000      86% /var/lib/docker
/dev/vdc1    10240000000   5120000000    5120000000      50% /mnt/with\\040space`;

describe("parseDfOutput", () => {
	it("parses real mounts and percent from the Capacity column", () => {
		const mounts = parseDfOutput(SAMPLE);
		expect(mounts).toHaveLength(4);
		expect(mounts[0]).toEqual({
			filesystem: "/dev/vda1",
			mount: "/",
			totalBytes: 10240000000,
			usedBytes: 5120000000,
			availableBytes: 5120000000,
			percent: 50,
		});
		expect(mounts[1].mount).toBe("/var/www");
		expect(mounts[1].percent).toBe(95);
		expect(mounts[2].mount).toBe("/var/lib/docker");
		expect(mounts[2].percent).toBe(86);
	});

	it("skips overlay and tmpfs pseudo filesystems", () => {
		const mounts = parseDfOutput(SAMPLE);
		expect(mounts.some((m) => m.filesystem === "overlay")).toBe(false);
		expect(mounts.some((m) => m.filesystem === "tmpfs")).toBe(false);
	});

	it("unescapes \\040 mount points", () => {
		const mounts = parseDfOutput(SAMPLE);
		expect(mounts.some((m) => m.mount === "/mnt/with space")).toBe(true);
	});

	it("returns empty on header-only or empty input", () => {
		expect(
			parseDfOutput("Filesystem 1-blocks Used Available Capacity Mounted on\n"),
		).toHaveLength(0);
		expect(parseDfOutput("")).toHaveLength(0);
	});

	it("derives percent from bytes when the Capacity column is missing", () => {
		const out = parseDfOutput("/dev/xd1 100000 75000 25000 - /data");
		expect(out).toHaveLength(1);
		expect(out[0].percent).toBe(75);
	});
});

describe("diskLevel", () => {
	it("mapps fill levels to the shared thresholds", () => {
		expect(diskLevel(0)).toBe(0);
		expect(diskLevel(50)).toBe(0);
		expect(diskLevel(DISK_THRESHOLDS.warning - 1)).toBe(0);
		expect(diskLevel(DISK_THRESHOLDS.warning)).toBe(1);
		expect(diskLevel(DISK_THRESHOLDS.error - 1)).toBe(1);
		expect(diskLevel(DISK_THRESHOLDS.error)).toBe(2);
		expect(diskLevel(DISK_THRESHOLDS.critical - 1)).toBe(2);
		expect(diskLevel(DISK_THRESHOLDS.critical)).toBe(3);
		expect(diskLevel(99)).toBe(3);
		expect(diskLevel(100)).toBe(3);
	});

	it("clamps out-of-range input", () => {
		expect(diskLevel(-1)).toBe(0);
		expect(diskLevel(101)).toBe(3);
	});
});

describe("formatBytes", () => {
	it("formats byte values with binary units", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KiB");
		expect(formatBytes(2048)).toBe("2 KiB");
		expect(formatBytes(1073741824)).toBe("1 GiB");
		expect(formatBytes(-5)).toBe("0 B");
	});
});

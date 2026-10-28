// === Disk usage probing (pure helpers) ===========================================
//
// Parses `df -P -B1` output into per-mount DiskUsage records and classifies the
// fill level against shared thresholds. Pure (no imports, no side effects) so the
// parsing and threshold boundaries are trivially unit-testable; the host-side
// jobs-worker calls them via execFile and raises diskPressure() alerts.

export interface DiskUsage {
	filesystem: string;
	mount: string;
	totalBytes: number;
	usedBytes: number;
	availableBytes: number;
	/** Fill percentage (0-100), taken from the `Capacity` column of `df -P`. */
	percent: number;
}

export type DiskLevel = 0 | 1 | 2 | 3;

/** Fill thresholds that decide when an alert fires (see DiskLevel). */
export const DISK_THRESHOLDS = {
	warning: 85,
	error: 90,
	critical: 95,
} as const;

/**
 * Pseudo/synthetic filesystems that mirror a backing store rather than owning
 * disk space of their own; alerting on them is noise (overlay mirrors /,
 * tmpfs/shm are RAM-backed, etc.).
 */
const IGNORED_FILESYSTEMS =
	/^(?:overlay|tmpfs|shm|devtmpfs|devfs|proc|sysfs|cgroup|cgroup2|debugfs|devpts|mqueue|squashfs|none|udev|efivarfs|pstore|securityfs|configfs|bpf|tracefs|hugetlbfs|rpc_pipefs|nsfs|binfmt_misc)$/;

/** Header column of `df -P` (first field) used to skip the title line. */
const DF_HEADER = "Filesystem";

/**
 * Parse `df -P -B1` stdout into real filesystem records. Lines whose mount is a
 * synthetic filesystem (overlay, tmpfs, ...) are skipped; `\040` escapes for
 * spaces in mount points are unescaped. Malformed or zero-size rows are ignored.
 */
export function parseDfOutput(output: string): DiskUsage[] {
	const result: DiskUsage[] = [];
	for (const rawLine of output.split("\n")) {
		const line = rawLine.trimEnd();
		if (!line) continue;

		const fields = line.split(/\s+/);
		if (fields.length < 5) continue;

		const [filesystem, totalStr, usedStr, availStr, capacityStr, ...rest] =
			fields;
		if (
			!filesystem ||
			filesystem === DF_HEADER ||
			!totalStr ||
			!usedStr ||
			!availStr ||
			!capacityStr
		) {
			continue;
		}
		if (IGNORED_FILESYSTEMS.test(filesystem)) continue;

		const totalBytes = Number(totalStr);
		const usedBytes = Number(usedStr);
		const availableBytes = Number(availStr);
		if (!Number.isFinite(totalBytes) || totalBytes <= 0) continue;

		const capacity = capacityStr.endsWith("%")
			? Number(capacityStr.slice(0, -1))
			: Number(capacityStr);
		const percent = Number.isFinite(capacity)
			? capacity
			: Math.round((usedBytes / totalBytes) * 100);

		const mount = rest.join(" ").replace(/\\040/g, " ");
		result.push({
			filesystem,
			mount,
			totalBytes,
			usedBytes,
			availableBytes,
			percent,
		});
	}
	return result;
}

/** Classify a fill percentage against DISK_THRESHOLDS (0 = fine, 3 = critical). */
export function diskLevel(percent: number): DiskLevel {
	if (percent >= DISK_THRESHOLDS.critical) return 3;
	if (percent >= DISK_THRESHOLDS.error) return 2;
	if (percent >= DISK_THRESHOLDS.warning) return 1;
	return 0;
}

/** Human-friendly byte formatting (KiB/MiB/GiB/…) for alert messages. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
	if (bytes === 0) return "0 B";
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	const unit = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1,
	);
	const value = bytes / 1024 ** unit;
	return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

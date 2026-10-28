"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-fetch";
import type {
	CompressionReport,
	NitroQuality,
	ScaleReport,
} from "@/lib/furni/nitro-quality";

function kb(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function CompressionPanel({ report }: { report: CompressionReport }) {
	const t = useTranslations("admin.studio.quality");
	const { texture, json } = report,
		// Differences that a renderer can actually see.
		visibleDiffs = texture.mismatchedPixels - texture.invisibleDifferences,
		// `webpEstimate.savingBytes` measures a PNG texture against a WebP
		// re-encode, so it reads ~0 for a bundle that already *is* WebP. The
		// honest WebP-vs-PNG comparison is the stored bytes against the PNG
		// encoding of the same artwork.
		pngSaving = texture.rawBytes - texture.pngEstimate.bytes;
	return (
		<section className="min-w-0 space-y-3 rounded-lg border p-3">
			<h3 className="font-semibold">
				{t("compressionTitle", { format: texture.format.toUpperCase() })}
				{texture.format === "webp"
					? texture.lossless
						? ` ${t("losslessVp8l")}`
						: ` ${t("lossyVp8")}`
					: ""}
			</h3>
			<dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
				<div>
					<dt className="text-muted-foreground">{t("bundle")}</dt>
					<dd className="font-medium">{kb(report.bundleBytes)}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">{t("texture")}</dt>
					<dd className="font-medium">
						{kb(texture.compressedBytes)}
						<span className="text-muted-foreground">
							{" "}
							({Math.round(report.textureShare * 100)}%)
						</span>
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">{t("metadata")}</dt>
					<dd className="font-medium">
						{kb(json.compressedBytes)}
						<span className="text-muted-foreground"> · ×{json.ratio}</span>
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">{t("container")}</dt>
					<dd className="font-medium">{kb(report.overheadBytes)}</dd>
				</div>
			</dl>
			<p className="text-xs text-muted-foreground">
				{t("textureDetail", {
					raw: kb(texture.rawBytes),
					ratio: texture.ratio,
					width: texture.width,
					height: texture.height,
					frames: texture.spriteCount,
				})}
			</p>
			{texture.format === "png" ? (
				<p className="text-xs">
					{texture.webpEstimate.savingBytes > 0
						? t.rich("legacyPngSaving", {
								size: kb(texture.webpEstimate.bytes),
								saving: kb(texture.webpEstimate.savingBytes),
								percent:
									texture.webpEstimate.bytes > 0
										? Math.round(
												(1 - texture.webpEstimate.bytes / texture.rawBytes) *
													100,
											)
										: 0,
								strong: (chunks) => <strong>{chunks}</strong>,
							})
						: t.rich("legacyPngNoGain", {
								size: kb(texture.webpEstimate.bytes),
								strong: (chunks) => <strong>{chunks}</strong>,
							})}
				</p>
			) : (
				<p className="text-xs">
					{pngSaving > 0
						? t.rich("webpSaving", {
								raw: kb(texture.rawBytes),
								png: kb(texture.pngEstimate.bytes),
								saving: kb(pngSaving),
								percent:
									texture.pngEstimate.bytes > 0
										? Math.round((pngSaving / texture.pngEstimate.bytes) * 100)
										: 0,
								strong: (chunks) => <strong>{chunks}</strong>,
							})
						: t("webpNoGain", {
								raw: kb(texture.rawBytes),
								png: kb(texture.pngEstimate.bytes),
							})}
				</p>
			)}
			<p className="text-xs">
				{visibleDiffs === 0 ? (
					<>
						{t.rich("pixelExact", {
							strong: (chunks) => (
								<span className="font-medium text-foreground">{chunks}</span>
							),
						})}
						{texture.invisibleDifferences > 0 && (
							<span className="text-muted-foreground">
								{" "}
								{t("invisibleDiffs", {
									count: texture.invisibleDifferences,
								})}
							</span>
						)}
					</>
				) : (
					<strong className="text-destructive">
						{t("texelsDiffer", { count: visibleDiffs })}
					</strong>
				)}
			</p>
		</section>
	);
}

function ScalePanel({
	report,
	classname,
	revision,
}: {
	report: ScaleReport;
	classname: string;
	revision: number;
}) {
	const [asset, setAsset] = useState(report.assets[0] ?? ""),
		[failed, setFailed] = useState(false);
	const t = useTranslations("admin.studio.quality");
	const stateLabel =
		report.state === "missing"
			? t("stateMissing")
			: report.state === "issues"
				? t("stateIssues")
				: report.derived
					? t("stateDerived")
					: t("statePresent");
	return (
		<section className="min-w-0 space-y-3 rounded-lg border p-3">
			<h3 className="font-semibold">
				{t("scaleTitle", { size: report.size, state: stateLabel })}
			</h3>
			<p className="text-xs text-muted-foreground">
				{t("spritesLine", {
					sprites: report.assets.length,
					animations: report.animations.length,
					directions: report.directions.join(", ") || "—",
				})}
			</p>
			{report.state === "missing" && (
				<p className="text-sm">{t("missingScale")}</p>
			)}
			{report.assets.length > 0 && (
				<>
					<label className="block text-sm">
						{t("sprite")}
						<select
							className="mt-1 block w-full rounded border bg-background p-2"
							value={asset}
							onChange={(event) => {
								setAsset(event.target.value);
								setFailed(false);
							}}
						>
							{report.assets.map((name) => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
						</select>
					</label>
					<div className="flex h-56 items-center justify-center overflow-auto rounded border bg-muted/30">
						{failed ? (
							<p role="alert">{t("renderFailed")}</p>
						) : (
							<img
								key={`${asset}-${revision}`}
								src={`/api/admin/studio/nitro-quality?classname=${encodeURIComponent(classname)}&asset=${encodeURIComponent(asset)}&v=${revision}`}
								alt={asset}
								style={{
									imageRendering: "pixelated",
									maxWidth: "none",
									flexShrink: 0,
								}}
								onError={() => setFailed(true)}
							/>
						)}
					</div>
				</>
			)}
			{report.issues.length > 0 && (
				<ul className="max-h-40 overflow-auto space-y-2 text-xs">
					{report.issues.map((issue) => (
						<li key={`${issue.asset ?? ""}-${issue.message}`}>
							<strong className="break-all">{issue.asset}</strong>{" "}
							{issue.message}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
export function NitroQualityPanel({ classname }: { classname: string }) {
	const t = useTranslations("admin.studio.quality");
	const [report, setReport] = useState<NitroQuality | null>(null),
		[error, setError] = useState(""),
		[revision, setRevision] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		setReport(null);
		setError("");
		void (async () => {
			try {
				const response = await adminFetch(
					`/api/admin/studio/nitro-quality?classname=${encodeURIComponent(classname)}&v=${revision}`,
					{ signal: controller.signal },
				);
				const data = await response.json();
				if (!response.ok) throw Error(data.error || t("inspectionFailed"));
				if (!controller.signal.aborted) setReport(data.report);
			} catch (error) {
				if (!controller.signal.aborted)
					setError(
						error instanceof Error ? error.message : t("inspectionFailed"),
					);
			}
		})();
		return () => controller.abort();
	}, [classname, revision, t]);
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-sm">{t("intro")}</p>
				<Button
					variant="outline"
					onClick={() => setRevision((value) => value + 1)}
				>
					{t("recheck")}
				</Button>
			</div>
			{error ? (
				<p role="alert">{error}</p>
			) : !report ? (
				<p role="status">{t("checking")}</p>
			) : (
				<div className="space-y-3">
					{report.compression && (
						<CompressionPanel report={report.compression} />
					)}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						{report.scales.map((scale) => (
							<ScalePanel
								key={`${scale.size}-${revision}`}
								report={scale}
								classname={classname}
								revision={revision}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

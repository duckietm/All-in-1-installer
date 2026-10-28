// @ts-nocheck
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const workflow = readFileSync(".gitea/workflows/ci.yaml", "utf8");
const deploy = readFileSync("scripts/ci-deploy.sh", "utf8");
it("uses two test workers and runs smoke checks in the deployment transaction", () => {
	expect(workflow).toContain("pnpm test:coverage --maxWorkers=4");
	expect(workflow).not.toContain("\n  e2e:");
	expect(workflow).toContain("bash scripts/ci-deploy.sh");
	expect(deploy).toContain(
		"node scripts/verify-deployed-release.mjs http://127.0.0.1:3002/api/health",
	);
});
it("locks CI and scheduled deployments using the same production lock", () => {
	expect(deploy).toContain('exec 9>"$deploy_dir/.deploy.lock"');
	expect(deploy).toContain("flock -w 1800 9");
	const scheduled = readFileSync("scripts/docker-update.sh", "utf8");
	expect(scheduled).toContain('exec 9>"$DIR/.deploy.lock"');
	expect(scheduled.indexOf("flock -w 1800 9")).toBeLessThan(
		scheduled.indexOf("git pull --ff-only"),
	);
});
it("preserves production runtime configuration and recent cache", () => {
	expect(deploy).toContain("--net=host");
	expect(deploy).toContain("--restart always");
	expect(deploy).toContain("/var/www/Gamedata:/var/www/Gamedata");
	expect(deploy).toContain("/app/storage");
	expect(deploy).not.toContain("--env-file");
	// The scoped prune lives in docker-prune.sh; deploys invoke it for both CI
	// and scheduled updates. It reclaims build cache + old unreferenced images
	// but never touches volumes.
	expect(deploy).toContain('bash "$deploy_dir/scripts/docker-prune.sh"');
	const prune = readFileSync("scripts/docker-prune.sh", "utf8");
	// The build cache is bounded by the cap alone. buildx treats --max-used-space
	// and --filter as mutually exclusive: combining them silently dropped the
	// cap, so the cache grew unbounded (49 GB observed on this host).
	expect(prune).toContain("docker builder prune -af --max-used-space=");
	expect(prune).toContain('docker image prune -af --filter "until=168h"');
	expect(prune).toContain('docker container prune -f --filter "until=24h"');
	// Emergency `--force` mode drops every age window to reclaim unused bytes,
	// but even then volumes are off-limits.
	expect(prune).toContain('== "--force" ]]');
	expect(prune).toContain("FORCE=1");
	expect(prune).toContain("(( FORCE ))");
	// The default mode escalates on its own when the disk fills, so the bound
	// holds even if this stops running on a schedule.
	expect(prune).toContain("FREE_KB");
	expect(prune).toMatch(/if\s*\(\(\s*FREE_KB\s*</);
	expect(deploy).not.toContain("--force");
	expect(deploy).not.toContain("docker volume prune");
	expect(prune).not.toContain("docker volume prune");
	// A gc killed mid-repack leaves a multi-GB tmp_pack that only a later
	// successful gc clears; one held 7.7 GB while the object store was 83 MB.
	expect(prune).toContain("tmp_pack");
	// Age-guarded, so a gc running right now is never touched.
	expect(prune).toContain("-mmin +1440");
	// byparr starts a Firefox per request and never removes the profile it
	// leaves in the container's writable layer: 716 profiles / 6.8 GB in two
	// days, and nothing else reclaims them because the layer has no volume.
	expect(prune).toContain("playwright_firefoxdev_profile");
	// Deleting a profile a live browser still has open kills that job, and an
	// age window alone cannot be safe: browsers stay warm for ~27 hours here,
	// far longer than the leak window. Liveness comes from the open fd instead.
	expect(prune).toContain("/proc/$p/fd");
	expect(prune).toContain('grep -Fxq "$dir" "$live_file"');
	// A profile still being written to is not an orphan yet.
	expect(prune).toContain("BYPARR_TMP_MIN_AGE_MIN");
});
it("builds the checked out source without fetching a moving remote branch", () => {
	const dockerfile = readFileSync("Dockerfile", "utf8");
	expect(dockerfile).toContain("COPY . .");
	expect(dockerfile).not.toMatch(
		/^ADD\s+https?:\/\/.*(?:repository|branches)/m,
	);
	expect(dockerfile).not.toMatch(/^RUN\s+git\s+(?:pull|fetch|clone)\b/m);
});

it("no longer publishes container images in CI", () => {
	expect(workflow).not.toContain("publish-container");
	expect(workflow).not.toContain("publish-container.sh");
});

it("keeps een duurzame buildcache buiten de CI-werkboom", () => {
	const preflight = readFileSync("scripts/ci-preflight.sh", "utf8");
	for (const script of [deploy, preflight]) {
		// `docker builder prune` gooit de buildcache weg en de CI-werkboom wordt
		// na elke job gewist. Zonder duurzame export downloadt de volgende build
		// alle 493 packages opnieuw; gemeten: reused 0 / downloaded 493.
		expect(script).toContain('--cache-from "type=local,src=$build_cache_dir"');
		expect(script).toContain(
			'--cache-to "type=local,dest=$build_cache_dir,mode=max"',
		);
		expect(script).toContain("CMS_BUILD_CACHE_DIR");
		// Zonder schrijftoegang bouwen we gewoon zonder cache; dat mag de
		// release niet blokkeren.
		expect(script).toContain("build zonder hergebruikte cache");
	}
	// Eigen map voor de preflight: een branch mag de release-cache nooit voeden.
	expect(deploy).toContain("/var/cache/epicnext-cms-buildcache");
	expect(preflight).toContain("/var/cache/epicnext-cms-preflight-cache");
});

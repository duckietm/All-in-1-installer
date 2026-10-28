import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { addSize32AllNitros } from "@/lib/services/repair-nitros";

interface Size32Status {
	running: boolean;
	startedAt: number | null;
	finishedAt: number | null;
	succeeded: number;
	failed: number;
	skipped: number;
	existing: number;
	lastMessage: string | null;
}

const status: Size32Status = {
	running: false,
	startedAt: null,
	finishedAt: null,
	succeeded: 0,
	failed: 0,
	skipped: 0,
	existing: 0,
	lastMessage: null,
};

function runJob(userId: number) {
	status.running = true;
	status.startedAt = Date.now();
	status.finishedAt = null;
	status.succeeded = 0;
	status.failed = 0;
	status.skipped = 0;
	status.existing = 0;
	status.lastMessage = "started";

	addSize32AllNitros((evt) => {
		if (evt.type === "progress") {
			if (evt.status === "done") status.succeeded++;
			else if (evt.status === "convert-failed" || evt.status === "write-failed")
				status.failed++;
			else status.skipped++;
			if (evt.message)
				status.lastMessage = `${evt.classname}: ${evt.status} ${evt.message}`;
		} else if (evt.type === "batch_complete") {
			status.succeeded = evt.succeeded ?? 0;
			status.failed = evt.failed ?? 0;
			status.skipped = evt.skipped ?? 0;
			status.existing = evt.existing ?? 0;
			status.lastMessage = "done";
		} else if (evt.type === "error") {
			status.lastMessage = evt.message ?? null;
		}
	})
		.then((result) => {
			status.succeeded = result.succeeded;
			status.failed = result.failed;
			status.skipped = result.skipped;
			status.existing = result.existing;
			status.lastMessage = "done";
			status.running = false;
			status.finishedAt = Date.now();
		})
		.catch((err) => {
			status.lastMessage = (err as Error).message;
			status.running = false;
			status.finishedAt = Date.now();
		});

	logAudit({
		userId,
		action: "furni_add_size32",
		target: "FurniNitro",
		targetId: 0,
	});
}

export const POST = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (_request, ctx) => {
		if (status.running) {
			return apiOk({ ...status, alreadyRunning: true });
		}
		try {
			runJob(ctx.session.user.id);
			return apiOk({ ...status, started: true });
		} catch (err) {
			return apiError((err as Error).message, 500);
		}
	},
);

export const GET = withAdmin({ permission: PERMS.ASSETS_IMPORT }, async () => {
	return apiOk({ ...status });
});

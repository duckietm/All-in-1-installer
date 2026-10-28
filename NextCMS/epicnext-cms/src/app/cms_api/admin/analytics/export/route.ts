import { sql } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { queryRows } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

const VALID_REPORTS = new Set(["registrations", "online-by-hour", "economy"]);

function csvEscape(value: unknown): string {
	if (value == null) return "";
	const str = String(value);
	if (/[",\n\r]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

function csvRow(values: unknown[]): string {
	return `${values.map(csvEscape).join(",")}\n`;
}

async function streamRegistrations(): Promise<ReadableStream<Uint8Array>> {
	const rows = await queryRows<{ day: string; cnt: bigint }>(sql`
    SELECT FROM_UNIXTIME(account_created, '%Y-%m-%d') AS day, COUNT(*) AS cnt
    FROM users
    WHERE account_created > UNIX_TIMESTAMP(NOW() - INTERVAL 90 DAY)
    GROUP BY day
    ORDER BY day ASC
  `);
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(csvRow(["day", "registrations"])));
			for (const r of rows) {
				controller.enqueue(encoder.encode(csvRow([r.day, Number(r.cnt)])));
			}
			controller.close();
		},
	});
}

async function streamOnlineByHour(): Promise<ReadableStream<Uint8Array>> {
	const rows = await queryRows<{ hour: number; cnt: bigint }>(sql`
    SELECT HOUR(FROM_UNIXTIME(last_online)) AS hour, COUNT(*) AS cnt
    FROM users
    WHERE last_online > UNIX_TIMESTAMP(NOW() - INTERVAL 30 DAY)
    GROUP BY hour
    ORDER BY hour ASC
  `);
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(csvRow(["hour", "active_users"])));
			for (const r of rows) {
				controller.enqueue(
					encoder.encode(csvRow([Number(r.hour), Number(r.cnt)])),
				);
			}
			controller.close();
		},
	});
}

async function streamEconomy(): Promise<ReadableStream<Uint8Array>> {
	const rows = await queryRows<{
		total_credits: bigint;
		total_pixels: bigint;
	}>(sql`
    SELECT SUM(credits) AS total_credits, SUM(pixels) AS total_pixels FROM users
  `);
	const totals = rows[0];
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(csvRow(["metric", "value"])));
			controller.enqueue(
				encoder.encode(
					csvRow(["total_credits", Number(totals?.total_credits ?? 0)]),
				),
			);
			controller.enqueue(
				encoder.encode(
					csvRow(["total_pixels", Number(totals?.total_pixels ?? 0)]),
				),
			);
			controller.close();
		},
	});
}

export const GET = withAdmin(
	{ permission: PERMS.ANALYTICS_EXPORT },
	async (request) => {
		const url = new URL(request.url);
		const report = url.searchParams.get("report") ?? "";
		if (!VALID_REPORTS.has(report)) {
			return apiError(
				`Unknown report. Use one of: ${[...VALID_REPORTS].join(", ")}`,
				400,
			);
		}

		const stream =
			report === "registrations"
				? await streamRegistrations()
				: report === "online-by-hour"
					? await streamOnlineByHour()
					: await streamEconomy();

		return new Response(stream, {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename="${report}.csv"`,
				"Cache-Control": "no-store",
			},
		});
	},
);

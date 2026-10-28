import { exec } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Resend } from "resend";
import { env } from "@/env";
import { logger } from "@/lib/logger";

let resend: Resend | null = null;

function getResend(): Resend | null {
	if (!env.RESEND_API_KEY) return null;
	if (!resend) resend = new Resend(env.RESEND_API_KEY);
	return resend;
}

function sendViaSendmail(
	to: string,
	subject: string,
	html: string,
	from: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		const headers = [
			`From: ${from}`,
			`To: ${to}`,
			`Subject: ${subject}`,
			"MIME-Version: 1.0",
			'Content-Type: text/html; charset="UTF-8"',
		].join("\r\n");

		const child = exec("sendmail -t", (error) => {
			if (error) {
				logger.error("Sendmail failed", {
					module: "email",
					error: error.message,
				});
				resolve(false);
			} else {
				resolve(true);
			}
		});

		if (child.stdin) {
			child.stdin.write(`${headers}\r\n\r\n${html}`);
			child.stdin.end();
		}
	});
}

async function writeToFile(
	to: string,
	subject: string,
	html: string,
	from: string,
): Promise<boolean> {
	try {
		const logDir = resolve(process.cwd(), "storage", "logs");
		await mkdir(logDir, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `email-${timestamp}.html`;
		const content = `<!-- To: ${to} | From: ${from} | Subject: ${subject} -->\n${html}`;
		await writeFile(resolve(logDir, filename), content, "utf-8");
		logger.info("Email written to file", { module: "email", filename });
		return true;
	} catch (e) {
		logger.error("Failed to write email to file", {
			module: "email",
			error: (e as Error).message,
		});
		return false;
	}
}

/** Send through configured transports; reject unsafe headers before any I/O. */
export async function sendMail(
	to: string,
	subject: string,
	html: string,
): Promise<boolean> {
	const from = env.SMTP_FROM ?? `no-reply@${env.HOTEL_NAME}`;

	if (
		[to, subject, from].some(
			(value) =>
				typeof value !== "string" ||
				!value.trim() ||
				Array.from(value).some(
					(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
				),
		)
	) {
		logger.warn("Email rejected: invalid header value", { module: "email" });
		return false;
	}

	const r = getResend();
	if (r) {
		try {
			await r.emails.send({ from, to, subject, html });
			return true;
		} catch (e) {
			logger.error("Resend API failed", {
				module: "email",
				error: (e as Error).message,
			});
		}
	}

	const ok = await sendViaSendmail(to, subject, html, from);
	if (ok) return true;

	await writeToFile(to, subject, html, from);
	return true;
}

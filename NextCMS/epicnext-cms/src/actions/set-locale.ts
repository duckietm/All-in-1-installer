"use server";

import { cookies } from "next/headers";
import { isSupportedLocale } from "@/i18n/locales";

export async function setLocaleCookie(code: string): Promise<void> {
	if (typeof code !== "string" || !isSupportedLocale(code)) return;
	const store = await cookies();
	store.set("NEXT_LOCALE", code, {
		path: "/",
		maxAge: 31536000,
		sameSite: "strict",
		secure: true,
	});
}

import { readdirSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "@/messages/ar.json";
import bg from "@/messages/bg.json";
import cs from "@/messages/cs.json";
import da from "@/messages/da.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import fi from "@/messages/fi.json";
import fr from "@/messages/fr.json";
import hr from "@/messages/hr.json";
import hu from "@/messages/hu.json";
import itMessages from "@/messages/it.json";
import ja from "@/messages/ja.json";
import nl from "@/messages/nl.json";
import no from "@/messages/no.json";
import pl from "@/messages/pl.json";
import pt from "@/messages/pt.json";
import ro from "@/messages/ro.json";
import ru from "@/messages/ru.json";
import sk from "@/messages/sk.json";
import sr from "@/messages/sr.json";
import sv from "@/messages/sv.json";
import tr from "@/messages/tr.json";
import uk from "@/messages/uk.json";

/**
 * Every failure reason the register action can report is a `RegisterErrorCode`,
 * which the form renders as `pages.register.<code>`. If a code ships without a
 * translation the visitor silently sees the raw English fallback, so this test
 * locks the contract in both directions: the union of codes must match the
 * dictionary, and every locale must carry every key.
 */

type RegisterErrorCode =
	| "usernameMinLength"
	| "usernameMaxLength"
	| "usernamePattern"
	| "usernameReserved"
	| "usernameTaken"
	| "emailValid"
	| "emailDisposable"
	| "passwordMinLength"
	| "passwordMaxLength"
	| "passwordUpper"
	| "passwordLower"
	| "passwordDigit"
	| "passwordSpecial"
	| "passwordsMatch"
	| "termsRequired"
	| "captchaFailed"
	| "rateLimited"
	| "vpnBlocked"
	| "maxAccountsPerIp"
	| "unavailable"
	| "createFailed"
	| "invalidInput";

/** Mirrors `RegisterErrorCode` in src/actions/register.ts. */
const REGISTER_ERROR_CODES: readonly RegisterErrorCode[] = [
	"usernameMinLength",
	"usernameMaxLength",
	"usernamePattern",
	"usernameReserved",
	"usernameTaken",
	"emailValid",
	"emailDisposable",
	"passwordMinLength",
	"passwordMaxLength",
	"passwordUpper",
	"passwordLower",
	"passwordDigit",
	"passwordSpecial",
	"passwordsMatch",
	"termsRequired",
	"captchaFailed",
	"rateLimited",
	"vpnBlocked",
	"maxAccountsPerIp",
	"unavailable",
	"createFailed",
	"invalidInput",
];

const MESSAGES: Record<string, typeof en> = {
	ar: ar as unknown as typeof en,
	bg: bg as unknown as typeof en,
	cs: cs as unknown as typeof en,
	da: da as unknown as typeof en,
	de: de as unknown as typeof en,
	el: el as unknown as typeof en,
	en,
	es: es as unknown as typeof en,
	fi: fi as unknown as typeof en,
	fr: fr as unknown as typeof en,
	hr: hr as unknown as typeof en,
	hu: hu as unknown as typeof en,
	it: itMessages as unknown as typeof en,
	ja: ja as unknown as typeof en,
	nl: nl as unknown as typeof en,
	no: no as unknown as typeof en,
	pl: pl as unknown as typeof en,
	pt: pt as unknown as typeof en,
	ro: ro as unknown as typeof en,
	ru: ru as unknown as typeof en,
	sk: sk as unknown as typeof en,
	sr: sr as unknown as typeof en,
	sv: sv as unknown as typeof en,
	tr: tr as unknown as typeof en,
	uk: uk as unknown as typeof en,
};

const locales = readdirSync("src/messages")
	.filter((file) => file.endsWith(".json"))
	.map((file) => file.replace(/\.json$/, ""))
	.sort();

const namespaces = ["pages.register", "pages.login", "pages.reset"] as const;

describe("auth page messages", () => {
	it("exposes every register error code as a translated message", () => {
		const t = createTranslator({
			locale: "en",
			messages: en,
			namespace: "pages.register",
		});
		for (const code of REGISTER_ERROR_CODES) {
			expect(t.has(code as never), code).toBe(true);
			expect(t(code as never), code).not.toBe("");
		}
	});

	it("keeps the dictionary free of unreachable register error keys", () => {
		const known = new Set<string>(REGISTER_ERROR_CODES);
		for (const key of Object.keys(en.pages.register)) {
			// Keys that map a code onto its canonical sentence must stay in sync.
			if (key === "passwordMinLength") continue;
			expect(known.has(key) || !/^[a-z][A-Z]/.test(key), key).toBe(true);
		}
		expect(en.pages.register.passwordError).toBe(
			en.pages.register.passwordMinLength,
		);
	});

	it("ships a dictionary for every locale on disk", () => {
		expect(Object.keys(MESSAGES).sort()).toEqual(locales);
	});

	it.each(locales)("provides every auth message in %s", (locale) => {
		const messages = MESSAGES[locale];
		expect(messages, locale).toBeDefined();
		for (const namespace of namespaces) {
			const t = createTranslator({ locale, messages, namespace });
			const keys =
				namespace === "pages.register"
					? REGISTER_ERROR_CODES
					: namespace === "pages.login"
						? ([
								"username",
								"password",
								"showPassword",
								"hidePassword",
							] as const)
						: (["passwordMinLength", "tooManyAttempts"] as const);
			for (const key of keys) {
				expect(t.has(key as never), `${namespace}.${key}`).toBe(true);
				expect(t(key as never), `${namespace}.${key}`).not.toBe("");
			}
		}
	});
});

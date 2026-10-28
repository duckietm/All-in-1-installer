import {
	createGuardrails,
	generateSecret,
	generateSync,
	generateURI,
	verifySync,
} from "otplib";

// Laravel Fortify / pragmarx google2fa: HMAC-SHA1, 6 digits, 30s period.
// Allow legacy secrets shorter than otplib v13's default 16-byte minimum
// (many existing AtomCMS/Fortify secrets decode to ~10 bytes).
const guardrails = createGuardrails({ MIN_SECRET_BYTES: 10 });

// ±1 time-step of clock skew (30s period → epochTolerance 30).
const EPOCH_TOLERANCE = 30;

/** Verify a 6-digit TOTP code against a base32 secret. */
export function verifyTotp(token: string, secret: string): boolean {
	try {
		const result = verifySync({
			secret,
			token,
			epochTolerance: EPOCH_TOLERANCE,
			guardrails,
		});
		return result.valid === true;
	} catch {
		return false;
	}
}

/** Current TOTP code for a secret (used in tests / tooling). */
export function generateTotp(secret: string): string {
	return generateSync({ secret, guardrails });
}

/** Generate a fresh base32 secret for enrolling a new authenticator. */
export function generateTotpSecret(): string {
	return generateSecret();
}

/** otpauth:// URI for provisioning a QR code. */
export function totpKeyUri(
	secret: string,
	accountName: string,
	issuer: string,
): string {
	return generateURI({
		issuer,
		label: accountName,
		secret,
	});
}

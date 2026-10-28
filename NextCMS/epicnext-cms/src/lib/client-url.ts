/**
 * Build the Nitro launch URL with the SSO ticket as the final query param.
 *
 * Any existing `sso` param is removed first (both from the query string and
 * from a `#fragment`), the ticket is appended as the last query param, and a
 * `#fragment` is kept after it so the ticket always reaches the server.
 */
export function buildClientLoginUrl(clientUrl: string, ticket: string): string {
	const [pathPart = "", ...fragments] = clientUrl.split("#");
	const fragment = fragments.join("#");

	const path = pathPart
		.replace(/([?&])sso=[^&#]*/gi, "$1")
		.replace(/([?&])&+/g, "$1")
		.replace(/[?&]$/, "");

	const sep = path.includes("?") ? "&" : "?";
	const query = `${path}${sep}sso=${encodeURIComponent(ticket)}`;
	return fragment ? `${query}#${fragment}` : query;
}

import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { setCsrfCookie } from "@/lib/foundation/security";

export const GET = withAdmin({ requireCsrf: false }, async () => {
	const token = await setCsrfCookie();
	if (!token) return apiError("Unable to initialize CSRF token", 500);

	const response = apiOk({ token });
	response.headers.set("Cache-Control", "no-store");
	return response;
});

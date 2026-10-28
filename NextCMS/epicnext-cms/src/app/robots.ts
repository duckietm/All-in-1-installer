import type { MetadataRoute } from "next";

// Installation metadata must be resolved from the running container.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
	const appUrl = process.env.APP_URL ?? "http://localhost:3000";
	return {
		rules: {
			userAgent: "*",
			allow: "/",
			disallow: ["/admin/", "/cms_api/", "/settings/", "/me/"],
		},
		sitemap: `${appUrl}/sitemap.xml`,
	};
}

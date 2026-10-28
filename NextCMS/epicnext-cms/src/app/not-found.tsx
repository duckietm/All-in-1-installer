import { Home, Newspaper } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ErrorScreen } from "@/components/error-screen";
import Link from "@/components/link";

export default async function NotFound() {
	const t = await getTranslations("pages.notFound");

	return (
		<ErrorScreen
			code={t("code")}
			title={t("title")}
			subtitle={t("subtitle")}
			body={t("body")}
			actions={
				<>
					<Link className="btn btn-primary" href="/">
						<Home className="error-screen-btn-icon" aria-hidden />
						{t("backHome")}
					</Link>
					<Link className="btn btn-outline" href="/news">
						<Newspaper className="error-screen-btn-icon" aria-hidden />
						{t("latestNews")}
					</Link>
				</>
			}
		/>
	);
}

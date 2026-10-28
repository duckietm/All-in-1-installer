import { redirect } from "next/navigation";

export default function BuilderClubPage() {
	redirect("/admin/catalog?catalog=bc");
}

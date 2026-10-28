"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
export function RefreshStatus({ label }: { label: string }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<Button
			type="button"
			variant="outline"
			disabled={pending}
			aria-busy={pending}
			onClick={() => startTransition(() => router.refresh())}
		>
			{pending ? "… " : ""}
			{label}
		</Button>
	);
}

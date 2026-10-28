"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { reportBrowserError } from "@/lib/browser-errors";

export default function PermissionRankError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const [reference, setReference] = useState(error.digest);
	useEffect(() => {
		setReference(error.digest ?? reportBrowserError(error, "browser.boundary"));
		if (error.digest) reportBrowserError(error, "browser.boundary");
	}, [error]);

	return (
		<Card className="border-[var(--admin-error-border)]">
			<CardHeader>
				<CardTitle>Permission page error</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm text-muted-foreground">
					The rank editor could not be rendered. The technical detail below is
					visible only inside this protected admin route.
				</p>
				<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
					{error.stack ?? error.message}
				</pre>
				{reference ? (
					<p className="text-xs text-muted-foreground">
						Reference: {reference}
					</p>
				) : null}
				<Button type="button" onClick={reset}>
					Try again
				</Button>
			</CardContent>
		</Card>
	);
}

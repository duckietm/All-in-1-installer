import { useState } from "react";
import { FurnitureJobHistory } from "@/components/admin/studio/furniture-jobs";
import { useFurnitureJobs } from "@/components/admin/studio/use-furniture-jobs";
import { furnitureJobFixture } from "../../../src/test/furniture-jobs-fixtures";

export function FurnitureJobsHarness() {
	const [completions, setCompletions] = useState(0);
	const [submitted, setSubmitted] = useState<string>("");
	const history = useFurnitureJobs(
		() => setCompletions((value) => value + 1),
		true,
		7,
	);
	return (
		<section aria-label="Import history hook">
			<button
				type="button"
				disabled={history.busy}
				onClick={async () =>
					setSubmitted(
						String(
							await history.submit(furnitureJobFixture.items, {
								translate: false,
							}),
						),
					)
				}
			>
				Submit import
			</button>
			<output aria-label="Submitted">{submitted}</output>
			<button
				type="button"
				onClick={() => {
					void history.refresh();
					void history.refresh();
				}}
			>
				Refresh twice
			</button>
			<button
				type="button"
				disabled={history.loading || !history.nextCursor}
				onClick={() => void history.navigate("next")}
			>
				Next page
			</button>
			<button
				type="button"
				disabled={history.loading || history.page === 1}
				onClick={() => void history.navigate("previous")}
			>
				Previous page
			</button>
			{window.location.search.includes("progress") && (
				<FurnitureJobHistory state={history} expanded />
			)}
			<output aria-label="Page">{history.page}</output>
			<output aria-label="Completions">{completions}</output>
			<output aria-label="Loading">{String(history.loading)}</output>
			<output aria-label="Jobs">
				{history.jobs.map((job) => `${job.id}:${job.state}`).join(",")}
			</output>
		</section>
	);
}

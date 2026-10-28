import { useState } from "react";
import { ImportAttachmentRecovery } from "@/components/admin/studio/import-attachment-recovery";
export function AttachmentHarness() {
	const [resumed, setResumed] = useState(0);
	return (
		<>
			<ImportAttachmentRecovery
				jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
				classname="fixture_chair"
				disabled={false}
				onResumed={async () => {
					setResumed((value) => value + 1);
				}}
			/>
			<output aria-label="Resumed count">{resumed}</output>
		</>
	);
}

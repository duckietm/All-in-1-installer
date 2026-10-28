import { AdminToaster } from "@/components/admin/admin-toaster";
import { NitroCleanupPanel } from "@/components/admin/studio/nitro-cleanup-panel";

export default function HousekeepingHotelNitroCleanupPage() {
	return (
		<>
			<NitroCleanupPanel />
			<AdminToaster />
		</>
	);
}

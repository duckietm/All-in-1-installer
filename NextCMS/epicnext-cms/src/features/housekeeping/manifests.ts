import { contentManifest } from "./domains/content/manifest";
import { economyManifest } from "./domains/economy/manifest";
import { hotelManifest } from "./domains/hotel/manifest";
import { operationsManifest } from "./domains/operations/manifest";
import { peopleManifest } from "./domains/people/manifest";
import { systemManifest } from "./domains/system/manifest";
import type { HousekeepingDomainManifest } from "./foundation/contracts";

export const HOUSEKEEPING_MANIFESTS = [
	operationsManifest,
	peopleManifest,
	contentManifest,
	economyManifest,
	hotelManifest,
	systemManifest,
] as const satisfies readonly HousekeepingDomainManifest[];

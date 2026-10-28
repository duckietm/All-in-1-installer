import { contentMigrationEntries } from "./content";
import { economyMigrationEntries } from "./economy";
import { hotelMigrationEntries } from "./hotel";
import { operationsMigrationEntries } from "./operations";
import { peopleMigrationEntries } from "./people";
import { systemMigrationEntries } from "./system";

export const HOUSEKEEPING_MIGRATION_MATRIX = [
	...operationsMigrationEntries,
	...peopleMigrationEntries,
	...contentMigrationEntries,
	...economyMigrationEntries,
	...hotelMigrationEntries,
	...systemMigrationEntries,
].sort((a, b) => a.legacyPath.localeCompare(b.legacyPath));

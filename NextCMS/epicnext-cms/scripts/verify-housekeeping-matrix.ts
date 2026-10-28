import { discoverLegacyPages } from "../src/features/housekeeping/migration/discover-legacy-pages";
import { HOUSEKEEPING_MIGRATION_MATRIX } from "../src/features/housekeeping/migration/matrix";
import { validateMigrationEntries } from "../src/features/housekeeping/migration/validate-matrix";

const discovered = discoverLegacyPages();
const issues = validateMigrationEntries(
	discovered,
	HOUSEKEEPING_MIGRATION_MATRIX,
);

if (issues.length > 0) {
	for (const issue of issues) console.error(issue);
	process.exitCode = 1;
} else {
	console.log(
		`Housekeeping migration matrix: ${HOUSEKEEPING_MIGRATION_MATRIX.length}/${discovered.length} valid`,
	);
}

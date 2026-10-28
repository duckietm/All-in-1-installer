# Catalog release manifests

The Git export writes `Gamedata/catalog-release.json` alongside the existing SQL,
furniture data, icons and Nitro bundles. Its SHA-256 content identity includes a
sorted list of repository-relative paths, byte lengths and SHA-256 hashes. There
is no generated timestamp or local source path. Identical exported bytes produce
identical manifests.

The manifest describes the files captured by this export, not every file already
in the destination repository. Existing behavior is preserved: missing optional
sources do not delete previously exported files; FurnitureData remains required;
SQL updates existing rows and does not delete absent rows.

SQL tables retain the existing single InnoDB repeatable-read consistent snapshot.
Asset copies are checked against source metadata and content before publication.
This is not a transaction spanning MySQL and the filesystem: uncoordinated writes
or newly created files outside the export queue can require another export.

Before committing, the exporter verifies captured files against the manifest and
compares Git index object identities with raw captured bytes, including the
manifest. Git filters and newline conversions that alter staged bytes cause the
export to fail and remain queued for retry.

This manifest provides provenance for an exported snapshot. It does not activate
a live generation. Live atomic switching additionally requires immutable complete
generations, a shared activation pointer respected by readers, concurrency and
failure handling, and retention/rollback rules.

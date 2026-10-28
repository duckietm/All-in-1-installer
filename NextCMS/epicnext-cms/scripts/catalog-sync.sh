#!/usr/bin/env bash
# Update the hotel catalog from a clone source (Habbo, retros, …).
#
# Two ways to use it:
#   ./scripts/catalog-sync.sh                     interactive menu
#   ./scripts/catalog-sync.sh --all --sql         same flags as the CLI, no menu
#
# The menu asks which sites to compare (Habbo is the preset) and what may be
# written. An audit is read-only; only a repair option touches the catalog, and
# applying the generated catalog SQL always needs its own choice.

cd "$(dirname "$0")/.." || exit 1
CLI="scripts/catalog-sync.ts"
# The react-server export condition resolves `server-only` to its no-op build,
# exactly like `pnpm jobs:worker` — the audit engine imports server modules.
RUN=(node --conditions=react-server --import tsx "$CLI")

# Any flag passed straight through means "no menu", so the same entry point
# works for cron/CI where only the flag path is safe.
if [ $# -gt 0 ]; then
	exec "${RUN[@]}" "$@"
fi

if [ ! -t 0 ]; then
	echo "Not a terminal. Use the non-interactive form, e.g.:" >&2
	echo "  $0 --all --sources=default-habbo-com" >&2
	exit 1
fi

echo "=== Catalog sync ==="
echo

# ── Step 1: which sites to compare ───────────────────────────────────────────
# Ask the CLI for the configured sources so the menu always matches the live
# `clone_sources` setting (and its defaults) instead of a hardcoded list.
mapfile -t SOURCE_ROWS < <("${RUN[@]}" --list-sources --tsv)
if [ "${#SOURCE_ROWS[@]}" -eq 0 ]; then
	echo "No clone sources are configured." >&2
	exit 1
fi

IDS=()
NAMES=()
echo "Compare this catalog against:"
for i in "${!SOURCE_ROWS[@]}"; do
	IFS=$'\t' read -r SOURCE_ID SOURCE_NAME _SOURCE_URL <<<"${SOURCE_ROWS[$i]}"
	IDS+=("$SOURCE_ID")
	NAMES+=("$SOURCE_NAME")
	printf "  %2d) %-24s %s\n" "$((i + 1))" "$SOURCE_NAME" "$SOURCE_ID"
done
echo
echo "  a) all sources above"
echo "  Enter) preset: ${NAMES[0]}"

read -r -p "Sources [a, 1-${#IDS[@]}, Enter]: " SOURCE_CHOICE

SELECTED_FLAG=""
case "$SOURCE_CHOICE" in
	"" | "Habbo" | "habbo" | "habbo.com")
		# Habbo is the first default preset (Habbo (COM)).
		SELECTED_FLAG="--sources=${IDS[0]}"
		SOURCE_LABEL="${NAMES[0]}"
		;;
	a | A | all)
		SOURCE_LABEL="all sources"
		;;
	*)
		SELECTED_IDS=()
		IFS=', ' read -r -a CHOICES <<<"$SOURCE_CHOICE"
		for CHOICE in "${CHOICES[@]}"; do
			[ -z "$CHOICE" ] && continue
			case "$CHOICE" in
				*[!0-9]* | "")
					echo "Invalid choice: '$CHOICE'" >&2
					exit 1
					;;
				*)
					if [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt "${#IDS[@]}" ]; then
						echo "Out of range: $CHOICE" >&2
						exit 1
					fi
					SELECTED_IDS+=("${IDS[$((CHOICE - 1))]}")
					;;
			esac
		done
		if [ "${#SELECTED_IDS[@]}" -eq 0 ]; then
			echo "No sources selected." >&2
			exit 1
		fi
		SELECTED_FLAG="--sources=$(IFS=,; echo "${SELECTED_IDS[*]}")"
		SOURCE_LABEL="${#SELECTED_IDS[@]} source(s)"
		;;
esac

# ── Step 2: what may be changed ──────────────────────────────────────────────
cat <<EOF

What should be done? (comparing with: $SOURCE_LABEL)
  1) Audit only — nothing is written
  2) Repair furniture icons + nitro bundles
  3) 2 + FurnitureData.json + catalog structure
   4) 3 + generate the catalog SQL (saved, not applied)
   5) 4 + APPLY the catalog SQL to the catalog
   6) 5 + import the furniture the source has and this hotel lacks
      (downloads icon + bundle, adds FurnitureData.json, creates the catalog
       page and the offer for every new item)
   7) 6 + reconcile FurnitureData.json / sprite ids / offer ids
   8) 7 + align items_base ids and rename legacy .nitro bundles (heaviest)
   d) Dry run — only report what 6 would import
   q) Cancel
EOF

read -r -p "Action [1]: " ACTION_CHOICE
ACTION_CHOICE="${ACTION_CHOICE:-1}"

ACTIONS=(audit)
CONFIRM=""
# Empty for the audit-only branch on purpose: no repair flags are passed.
ACTION_FLAGS=()
# Prints a warning when the chosen source only serves furnidata (no .nitro
# bundles), so the import step would find nothing to download.
warn_compare_only_sources() {
	case "$SOURCE_LABEL" in
	"Habbo (COM)" | "Habbo (NL)" | "Habbo (DE)" | "Habbo (FR)" | \
	"Habbo (ES)" | "Habbo (FI)" | "Habbo (BR)" | "Habbo (TR)" | \
	"Habbo (IT - GitHub mirror)" | "YabboHotel" | "Wibbo" | "Hubba.cc")
		echo
		echo "Note: ${SOURCE_LABEL} only serves furnidata — there are no .nitro"
		echo "bundles to import, so the import step can only COMPARE."
		echo "To actually import furniture, pick a source that serves bundles"
		echo "(Habblet City, VirtualCity, SodaStudios, Habboon, Leet, Hubbly) or 'a'."
		;;
	esac
}
case "$ACTION_CHOICE" in
	1)
		ACTIONS=(audit "[nothing written]")
		;;
	2)
		ACTIONS=(audit "icons + nitro bundles downloaded")
		ACTION_FLAGS=(--icons --nitros)
		;;
	3)
		ACTIONS=(audit "icons + nitro bundles + FurnitureData.json + structure")
		ACTION_FLAGS=(--all)
		;;
	4)
		ACTIONS=(audit "everything + catalog SQL generated")
		ACTION_FLAGS=(--all --sql)
		;;
	5)
		ACTIONS=(audit "everything + catalog SQL APPLIED")
		ACTION_FLAGS=(--all --sql --apply-sql)
		CONFIRM="This writes to the catalog. Continue? [y/N]: "
		;;
	6)
		ACTIONS=(audit "everything + catalog SQL + import new furniture")
		ACTION_FLAGS=(--all --sql --apply-sql --import-new)
		CONFIRM="This writes to the catalog AND imports every missing item. Continue? [y/N]: "
		;;
	7)
		ACTIONS=(audit "everything + import + reconcile")
		ACTION_FLAGS=(
			--all --sql --apply-sql --import-new --reconcile --fix-sprite-ids
			--rebuild-offers
		)
		CONFIRM="This writes to the catalog AND imports every missing item. Continue? [y/N]: "
		;;
	8)
		ACTIONS=(audit "everything + import + reconcile + id alignment + rename")
		ACTION_FLAGS=(
			--all --sql --apply-sql --import-new --reconcile --fix-sprite-ids
			--rebuild-offers --align-ids --rename-bundles --apply
		)
		read -r -p "  This rewrites items_base ids and renames bundle files. Type RUN to confirm: " REPLY
		if [ "$REPLY" != "RUN" ]; then
			echo "Cancelled."
			exit 0
		fi
		;;
	d | D)
		ACTIONS=(audit "report only — nothing is imported")
		ACTION_FLAGS=(--import-new --dry-run)
		;;
	q | Q)
		echo "Cancelled."
		exit 0
		;;
	*)
		echo "Invalid action: '$ACTION_CHOICE'" >&2
		exit 1
		;;
esac

echo
printf 'Running: %s against %s\n' "${ACTIONS[1]}" "$SOURCE_LABEL"
case "$ACTION_FLAGS" in
	*--import-new*) warn_compare_only_sources ;;
esac
if [ -n "$CONFIRM" ]; then
	read -r -p "$CONFIRM" REPLY
	if [ "$REPLY" != "y" ] && [ "$REPLY" != "Y" ]; then
		echo "Cancelled."
		exit 0
	fi
fi

echo
# shellcheck disable=SC2086
"${RUN[@]}" $SELECTED_FLAG "${ACTION_FLAGS[@]}"

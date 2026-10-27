using System.Reflection;

namespace AllInOneInstaller.Remote;

/// <summary>What the Plus import changes in the hotel database.</summary>
public enum PlusImportMode
{
    /// <summary>Adds the furniture Polaris does not have yet; the catalog stays as it is.</summary>
    FurnitureOnly,
    /// <summary>Adds the furniture and replaces the normal catalog with the Plus catalog (Builders Club and Habbicons stay).</summary>
    FurnitureAndCatalog
}

/// <summary>The counts the import reports at the end.</summary>
public sealed record PlusImportResult(int FurnitureExisting, int FurnitureNew, int CrackablesWithoutPrizes, int Pages, int CatalogItems, string SafetyBackup);

/// <summary>
/// Tools → Import Plus database: a PlusEMU dump (such as its fresh install) into the Polaris hotel database. The dump is
/// loaded into a staging database next to the hotel's, and Remote/Sql/plus-to-polaris-*.sql convert it: the reverse of
/// plus-migrator (github.com/plus-emulator/plus-migrator), which goes from Arcturus/Polaris to Plus.
/// </summary>
public static class PlusImport
{
    /// <summary>Where the dump is loaded; dropped again at the end.</summary>
    public const string StagingDatabase = "plus_import";

    private static string Sql(string name)
    {
        using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"AllInOneInstaller.Remote.Sql.{name}")
                              ?? throw new InvalidOperationException($"{name} is not built into the program.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    /// <summary>The conversion for <paramref name="mode"/>, with @S@ and @T@ still in it (the script fills them in).</summary>
    public static string ConversionSql(PlusImportMode mode) =>
        Sql("plus-to-polaris-furniture.sql") + (mode == PlusImportMode.FurnitureAndCatalog ? "\n" + Sql("plus-to-polaris-catalog.sql") : "");

    public static async Task<PlusImportResult> ImportAsync(ServerConnection connection, string remoteFile, PlusImportMode mode,
        Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            set -o pipefail
            {{ServerTools.DatabaseName}}
            staging={{StagingDatabase}}
            f={{ServerConnection.ShellQuote(remoteFile)}}
            sql=$(mktemp)
            out=$(mktemp)
            # The conversion comes over stdin.
            cat > "$sql"
            cleanup() { rm -f "$sql" "$out" "$f"; mariadb -e "DROP DATABASE IF EXISTS \`$staging\`" 2>/dev/null || true; }
            trap cleanup EXIT
            [ -s "$f" ] || fail "The uploaded file $f is missing or empty."
            chmod 600 "$f"
            if gzip -t "$f" 2>/dev/null; then read_dump() { gunzip -c "$f"; }; else read_dump() { cat "$f"; }; fi
            (set +o pipefail; read_dump | grep -qE 'CREATE TABLE `furniture`') ||
              fail "$(basename "$f") is not a PlusEMU dump: it has no furniture table (Polaris and Arcturus call it items_base)."

            mariadb -N "$db" -e 'SELECT 1' >/dev/null 2>&1 || fail "The hotel database $db does not exist or MariaDB does not run."
            for table in items_base catalog_pages catalog_items catalog_clothing items_crackable permission_ranks; do
              [ "$(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$db' AND table_name = '$table'")" = 1 ] ||
                fail "$db has no $table table: it is not a Polaris database (or the emulator never started on it)."
            done

            echo "> Safety backup of $db first"
            install -d -m 700 {{ServerTools.BackupDirectory}}
            safety={{ServerTools.BackupDirectory}}/$db-before-plus-import-$(date +%Y%m%d-%H%M%S).sql.gz
            (umask 077; mariadb-dump --single-transaction --quick --routines --triggers --events --hex-blob --databases "$db" | gzip -6 > "$safety")
            echo "  $safety ($(du -h "$safety" | cut -f1))"
            echo "SAFETY=$safety"

            d={{EmulatorInstaller.Directory}}
            log={{EmulatorInstaller.LogDirectory}}/emulator.log
            {{EmulatorInstaller.ControlFunctions}}
            emulator=
            if [ -x "$d/emulator" ]; then
              emulator=yes
              echo "> Stopping the emulator"
              stop_emulator
            fi
            # Whatever happens from here, the emulator runs again at the end.
            restart() { [ -n "$emulator" ] && { echo "> Starting the emulator"; start_emulator; wait_loaded; } || true; }

            echo "> Loading $(basename "$f") ($(du -h "$f" | cut -f1)) into the staging database $staging"
            mariadb -e "DROP DATABASE IF EXISTS \`$staging\`; CREATE DATABASE \`$staging\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            start=$(date +%s)
            if ! read_dump | sed -E "/^(CREATE DATABASE|USE) /s/\`[^\`]+\`/\`$staging\`/" | mariadb "$staging"; then
              restart
              fail "Loading the Plus dump failed (see above). The hotel database was not changed."
            fi
            echo "  $(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$staging'") tables in $(( $(date +%s) - start )) seconds"
            for table in furniture catalog_pages catalog_offers catalog_offer_products catalog_page_offers catalog_page_texts catalog_page_images catalog_bot_presets; do
              [ "$(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$staging' AND table_name = '$table'")" = 1 ] ||
                { restart; fail "The Plus dump has no $table table; this Plus version is not supported. The hotel database was not changed."; }
            done
            # Tables of newer Polaris versions: without them, the lines that use them are left out.
            for table in catalog_id_sequences catalog_manager_state; do
              [ "$(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$db' AND table_name = '$table'")" = 1 ] ||
                sed -i "/$table/d" "$sql"
            done

            echo "> Converting to Polaris ({{(mode == PlusImportMode.FurnitureAndCatalog ? "furniture and catalog" : "furniture only")}})"
            sed -i "s/@S@/$staging/g; s/@T@/$db/g" "$sql"
            start=$(date +%s)
            if ! mariadb -N "$staging" < "$sql" > "$out" 2>&1; then
              sed 's/^/  /' "$out" | tail -n 20
              echo "> The conversion stopped: putting $db back as it was"
              gunzip -c "$safety" | mariadb || echo "  Restoring failed: import $safety with Import full database."
              restart
              fail "Converting the Plus data failed (see above). The hotel database is as it was before."
            fi
            echo "  done in $(( $(date +%s) - start )) seconds"
            # The report: the counts the tool reads stay KEY=value, the rest is written out.
            awk -F'=' '
              /^(FURNI_EXISTING|FURNI_NEW|CRACKABLE_WITHOUT_PRIZES|PAGES|CATALOG_ITEMS)=/ { print; next }
              $1 == "FURNI_HOW" { split($2, a, ":"); print "  New furniture, interaction " a[1] ": " a[2]; next }
              $1 == "FALLBACK" { split($2, a, ":"); print "  No Polaris interaction for the Plus type " a[1] " (" a[2] "x, e.g. " a[3] "): plain furniture"; next }
              $1 == "BC_PAGES_KEPT" { print "  Builders Club: " $2 " Plus pages left out, Polaris keeps its own"; next }
              $1 == "PRODUCTS_SKIPPED" { split($2, a, ":"); print "  Left out: " a[2] " " a[1] " products (Polaris has no such product)"; next }
              $1 == "OFFERS_WITHOUT_ITEMS" { if ($2 > 0) print "  Offers with nothing Polaris can sell: " $2 " (left out)"; next }
              $1 == "POLARIS_PAGES_KEPT" { split($2, a, ":"); if (a[1] > 0) print "  Kept from the Polaris catalog: " a[2]; next }
              { print "  " $0 }' "$out"
            # When the emulator does not load the converted database, the hotel does not stay down: the database goes
            # back and the emulator starts on it. wait_loaded ends with fail, so it runs in a subshell here.
            if [ -n "$emulator" ]; then
              echo "> Starting the emulator"
              start_emulator
              if ! (wait_loaded); then
                echo "> The emulator does not start with the converted database: putting $db back as it was"
                gunzip -c "$safety" | mariadb || fail "Restoring failed: import $safety with Import full database."
                start_emulator
                (wait_loaded) || true
                fail "The emulator does not start with the converted database (its log is above). $db is as it was before the import."
              fi
            fi
            """;
        ScriptValues values = await RemoteScript.RunCapturingAsync(connection, script, log, "Importing the Plus database failed",
            ["SAFETY", "FURNI_EXISTING", "FURNI_NEW", "CRACKABLE_WITHOUT_PRIZES", "PAGES", "CATALOG_ITEMS"], token, stdin: ConversionSql(mode));
        return new PlusImportResult(values.Int("FURNI_EXISTING"), values.Int("FURNI_NEW"), values.Int("CRACKABLE_WITHOUT_PRIZES"),
            values.Int("PAGES"), values.Int("CATALOG_ITEMS"), values["SAFETY"] ?? "");
    }
}

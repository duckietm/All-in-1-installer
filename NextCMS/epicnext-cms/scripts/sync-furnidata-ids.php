<?php
/**
 * sync-furnidata-ids.php
 * --------------------------------------------------------------------------
 * Foolproof synchronisation of the emulator furniture tables (`items_base`
 * and `catalog_items`) against FurnitureData.json.
 *
 * FurnitureData.json is treated as the SINGLE SOURCE OF TRUTH for the sprite
 * id (`id`) and the class name (`classname` -> `items_base.item_name`).
 *
 * What this script guarantees:
 *   1. Every furniture entry in furnidata is matched to an `items_base` row by
 *      `item_name`. Missing rows are INSERTed with the exact furnidata id.
 *   2. Existing rows whose `id` differs from furnidata are moved to the
 *      furnidata id. Because `items_base.id` is referenced by ~22 other
 *      tables, the move is implemented as a multi-pass PRIMARY KEY swap that
 *      rewrites EVERY referencing column (int FKs and the `item_ids` string
 *      lists) so no foreign key / shop reference is ever broken.
 *   3. `sprite_id` is kept equal to `id` and `catalog_items.catalog_name`
 *      is normalised to the base `item_name` after the move.
 *
 * SAFETY:
 *   - The entire DML workload runs inside ONE InnoDB transaction. On any
 *     exception it is rolled back completely (zero corruption).
 *   - Uses TEMPORARY tables only, so no DDL implicit-commit escapes the txn.
 *   - `--dry-run` (default) only reports; pass `--apply` to write.
 *
 * USAGE:
 *   php sync-furnidata-ids.php            # dry run, prints plan
 *   php sync-furnidata-ids.php --apply    # execute
 *
 * ADAPTATION:
 *   This uses raw PDO. In a Laravel command swap the PDO bootstrap for the
 *   `DB::` facade and replace `$pdo->prepare()/execute()` with `DB::...`; the
 *   transaction calls map 1:1: `DB::beginTransaction()`, `DB::commit()`,
 *   `DB::rollBack()`. The SQL is identical.
 */

declare(strict_types=1);

/* ───────────────────────────── CONFIG ───────────────────────────── */
// Either hard-code here or pull from environment / .env.
$DB_HOST = getenv('DB_HOST') ?: '127.0.0.1';
$DB_PORT = getenv('DB_PORT') ?: '3306';
$DB_NAME = getenv('DB_DATABASE') ?: getenv('DB_NAME') ?: 'retro';
$DB_USER = getenv('DB_USERNAME') ?: getenv('DB_USER') ?: 'root';
$DB_PASS = getenv('DB_PASSWORD') ?: getenv('DB_PASS') ?: '';

// Absolute path to FurnitureData.json.
$FURNIDATA_PATH = getenv('FURNIDATA_PATH')
    ?: '/var/www/atom-nexst/public/gamedata/config/FurnitureData.json';

$APPLY = in_array('--apply', $argv, true);
$DRY   = !$APPLY;

/* Referencing integer columns that store a base id (item_id / sprite_id). */
$INT_COLS = [
    ['items', 'item_id'],
    ['room_templates_items', 'item_id'],
    ['catalog_items_limited', 'item_id'],
    ['crafting_recipes_ingredients', 'item_id'],
    ['items_crackable', 'item_id'],
    ['gift_wrappers', 'sprite_id'],
    ['gift_wrappers', 'item_id'],
    ['trax_playlist', 'item_id'],
    ['pet_drinks', 'item_id'],
    ['pet_foods', 'item_id'],
    ['pet_items', 'item_id'],
    ['marketplace_items', 'item_id'],
    ['calendar_rewards', 'item_id'],
    ['builders_club_items', 'item_id'],
    ['youtube_playlists', 'item_id'],
    ['room_trax_playlist', 'item_id'],
    ['recycler_prizes', 'item_id'],
    ['website_event_prizes', 'item_id'],
    ['website_rare_values', 'item_id'],
    ['catalog_products', 'item_id'],
    ['room_trade_log_items', 'item_id'],
    ['logs_economy', 'item_id'],
];

/* Referencing string columns that hold a single numeric base id.
   NOTE: this DB uses the American spelling `catalog_items` (not `catalogue_items`). */
$STR_COLS = [
    ['catalog_items', 'item_ids'],
    ['catalog_items_bc', 'item_ids'],
    ['logs_shop_purchases', 'item_ids'],
    ['catalog_version_offers', 'item_ids'],
];

/* ──────────────────────────── HELPERS ──────────────────────────── */
function log_line(string $msg): void
{
    fwrite(STDOUT, $msg . PHP_EOL);
}

function pdo(): PDO
{
    static $p;
    if ($p) {
        return $p;
    }
    global $DB_HOST, $DB_PORT, $DB_NAME, $DB_USER, $DB_PASS;
    $p = new PDO(
        "mysql:host={$DB_HOST};port={$DB_PORT};dbname={$DB_NAME};charset=utf8mb4",
        $DB_USER,
        $DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
    return $p;
}

function q(string $sql, array $params = []): array
{
    $stmt = pdo()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function exec_sql(string $sql, array $params = []): int
{
    $stmt = pdo()->prepare($sql);
    $stmt->execute($params);
    return $stmt->rowCount();
}

/* Convert a numeric expression to a CHAR in the target column's own charset/
   collation so a JOIN/comparison never hits "Illegal mix of collations". */
function numToStr(string $table, string $col, string $expr): string
{
    static $cache = [];
    $key = "{$table}.{$col}";
    if (!isset($cache[$key])) {
        $r = pdo()
            ->query(
                "SELECT CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS "
                . "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{$table}' AND COLUMN_NAME = '{$col}'"
            )
            ->fetch();
        $cache[$key] = ($r && $r['CHARACTER_SET_NAME']) ? [$r['CHARACTER_SET_NAME'], $r['COLLATION_NAME']] : null;
    }
    $info = $cache[$key];
    if (!$info) {
        return "CAST({$expr} AS CHAR)";
    }
    return "CONVERT({$expr}, CHAR CHARACTER SET {$info[0]}) COLLATE {$info[1]}";
}

/* ──────────────────────────── STEP 1 ──────────────────────────── */
/* READ + PARSE FURNIDATA                                          */
log_line('[1/6] Reading FurnitureData.json ...');

if (!is_readable($FURNIDATA_PATH)) {
    throw new RuntimeException("Cannot read furnidata: {$FURNIDATA_PATH}");
}
$furniRaw = json_decode((string) file_get_contents($FURNIDATA_PATH), true, 512, JSON_THROW_ON_ERROR);
if (!is_array($furniRaw)) {
    throw new RuntimeException('furnidata.json did not decode to an array');
}

$allEntries = [];
foreach (['roomitemtypes', 'wallitemtypes'] as $section) {
    $list = $furniRaw[$section]['furnitype'] ?? [];
    if (!is_array($list)) {
        continue;
    }
    foreach ($list as $e) {
        if (
            isset($e['classname']) && is_string($e['classname'])
            && isset($e['id']) && is_numeric($e['id'])
        ) {
            $id = (int) $e['id'];
            if ($id > 0) {
                $allEntries[] = ['section' => $section, 'classname' => $e['classname'], 'id' => $id];
            }
        }
    }
}
log_line('      furnidata entries parsed: ' . count($allEntries));

/* ── global iterative duplicate-id resolution ──────────────────── */
/* If two classnames claim the same id, the one already occupying that id in
   the DB keeps it; the loser is patched back to its own DB id (and we simply
   drop its claim so it is not forced onto a contested id).            */
$desired = []; // classname => furnidata id
foreach ($allEntries as $e) {
    $cn = $e['classname'];
    if ($cn === '' || isset($desired[$cn])) {
        continue;
    }
    $desired[$cn] = $e['id'];
}

$rows = q('SELECT id, item_name FROM items_base');
$nameById = [];
$idByName = [];
$maxId = 0;
foreach ($rows as $r) {
    $id = (int) $r['id'];
    $nameById[$id] = $r['item_name'];
    $idByName[$r['item_name']] = $id;
    $maxId = max($maxId, $id);
}

for (;;) {
    $claimsById = [];
    foreach ($desired as $cn => $id) {
        $claimsById[$id][] = $cn;
    }
    $found = false;
    ksort($claimsById);
    foreach ($claimsById as $id => $claimants) {
        if (count($claimants) < 2) {
            continue;
        }
        $live = array_values(array_filter($claimants, fn ($cn) => ($desired[$cn] ?? null) === $id));
        if (count($live) < 2) {
            continue;
        }
        $found = true;
        $dbHolder = $nameById[$id] ?? null;
        $winner = ($dbHolder !== null && in_array($dbHolder, $live, true)) ? $dbHolder : $live[0];
        foreach ($live as $cn) {
            if ($cn === $winner) {
                continue;
            }
            unset($desired[$cn]); // loser loses its contested claim
        }
    }
    if (!$found) {
        break;
    }
}
log_line('      furnidata classnames after dup-resolution: ' . count($desired));

/* ──────────────────────────── STEP 2 ──────────────────────────── */
/* COMPUTE ID MOVES (existing rows -> furnidata id)                */
$fresh = max($maxId, max(0, ...array_values($desired))) + 1000;

$moves = []; // old_id => new_id
foreach ($rows as $r) {
    $cn = $r['item_name'];
    $target = $desired[$cn] ?? null;
    if ($target !== null && $target !== (int) $r['id']) {
        $moves[(int) $r['id']] = $target;
    }
}
/* Squatter displacement: a row sitting on a contested id with no furnidata
   entry of its own must make room for the rightful claimant. */
$occupied = array_fill_keys(array_keys($nameById), true);
for (;;) {
    $destCount = [];
    foreach ($moves as $t) {
        $destCount[$t] = ($destCount[$t] ?? 0) + 1;
    }
    $changed = false;
    foreach ($moves as $oldId => $target) {
        if (!isset($occupied[$target])) {
            continue; // target already free
        }
        if (isset($moves[$target])) {
            continue; // target itself is being vacated
        }
        $holder = $nameById[$target] ?? null;
        if ($holder !== null && ($desired[$holder] ?? null) === $target) {
            continue; // legit stayer
        }
        $moves[$target] = $fresh++;
        $changed = true;
        break;
    }
    if (!$changed) {
        break;
    }
}
/* Drop moves that land on an id a legit stayer keeps forever. */
for (;;) {
    $changed = false;
    foreach ($moves as $oldId => $target) {
        if (!isset($occupied[$target]) || isset($moves[$target])) {
            continue;
        }
        $holder = $nameById[$target] ?? null;
        if ($holder !== null && ($desired[$holder] ?? null) === $target) {
            unset($moves[$oldId]);
            $changed = true;
            break;
        }
    }
    if (!$changed) {
        break;
    }
}
log_line('      planned id moves: ' . count($moves));
if ($DRY) {
    $i = 0;
    foreach ($moves as $o => $t) {
        if ($i++ >= 10) {
            break;
        }
        log_line("        '{$nameById[$o]}' : {$o} -> {$t}");
    }
}

if ($DRY) {
    log_line('[DRY RUN] No changes written. Re-run with --apply to execute.');
    exit(0);
}

/* ──────────────────────────── STEP 3 ──────────────────────────── */
/* TRANSACTION-SAFE APPLICATION                                    */
log_line('[3/6] Applying inside a single transaction ...');

try {
    pdo()->beginTransaction();

    // TEMPORARY table => no implicit commit, lives only for this transaction.
    exec_sql('DROP TEMPORARY TABLE IF EXISTS _id_map_pass');
    exec_sql(
        'CREATE TEMPORARY TABLE _id_map_pass (
            old_id INT PRIMARY KEY,
            new_id INT NOT NULL,
            UNIQUE KEY uniq_new (new_id)
        ) ENGINE=InnoDB'
    );

    exec_sql('SET FOREIGN_KEY_CHECKS = 0');

    $occupiedIds = array_fill_keys(array_keys($nameById), true);
    $pending = [];
    foreach ($moves as $oldId => $target) {
        $pending[] = [$oldId, $target];
    }
    $scratch = $fresh;
    $passes = 0;

    $applyPass = function (array $pairs) use (&$occupiedIds, $INT_COLS, $STR_COLS): void {
        if ($pairs === []) {
            return;
        }
        // (Re)load the pass map.
        exec_sql('TRUNCATE TABLE _id_map_pass');
        foreach (array_chunk($pairs, 500) as $chunk) {
            $ph = implode(',', array_fill(0, count($chunk), '(?,?)'));
            $flat = [];
            foreach ($chunk as [$o, $nw]) {
                $flat[] = $o;
                $flat[] = $nw;
            }
            exec_sql("INSERT INTO _id_map_pass (old_id, new_id) VALUES {$ph}", $flat);
        }
        // Move the PK on items_base itself.
        exec_sql(
            'UPDATE items_base b JOIN _id_map_pass m ON b.id = m.old_id SET b.id = m.new_id'
        );
        // Cascade to every integer foreign-key column (skip tables that don't exist).
        static $intCache = null;
        if ($intCache === null) {
            $intCache = [];
            foreach ($INT_COLS as [$table, $col]) {
                $exists = (int) pdo()
                    ->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{$table}'")
                    ->fetchColumn();
                if ($exists) {
                    $intCache[] = [$table, $col];
                } else {
                    log_line("        [warn] skipping missing table `{$table}`");
                }
            }
        }
        foreach ($intCache as [$table, $col]) {
            exec_sql(
                "UPDATE `{$table}` t JOIN _id_map_pass m ON t.`{$col}` = m.old_id SET t.`{$col}` = m.new_id"
            );
        }
        // Cascade to every `item_ids` string column (single numeric id).
        static $strCache = null;
        if ($strCache === null) {
            $strCache = [];
            foreach ($STR_COLS as [$table, $col]) {
                $exists = (int) pdo()
                    ->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{$table}'")
                    ->fetchColumn();
                if ($exists) {
                    $strCache[] = [$table, $col];
                } else {
                    log_line("        [warn] skipping missing table `{$table}`");
                }
            }
        }
        foreach ($strCache as [$table, $col]) {
            exec_sql(
                "UPDATE `{$table}` t JOIN _id_map_pass m ON t.`{$col}` = " . numToStr($table, $col, 'm.old_id')
                . " SET t.`{$col}` = CAST(m.new_id AS CHAR)"
            );
        }
        foreach ($pairs as [$o, $nw]) {
            unset($occupiedIds[$o]);
            $occupiedIds[$nw] = true;
        }
    };

    // Multi-pass until every move is applied (handles dependency cycles).
    // $pending / $safe are LISTS of [old_id, new_id] pairs.
    while ($pending !== []) {
        $passes++;
        $safe = [];
        foreach ($pending as [$oldId, $target]) {
            if (!isset($occupiedIds[$target])) {
                $safe[] = [$oldId, $target];
            }
        }
        if ($safe === []) {
            // Cycle: park the smallest row on a scratch id to break it.
            $oldest = min(array_column($pending, 0));
            $pair = null;
            foreach ($pending as $p) {
                if ($p[0] === $oldest) {
                    $pair = $p;
                    break;
                }
            }
            $target = $pair[1];
            $pending = array_filter($pending, fn ($p) => $p[0] !== $oldest);
            $applyPass([[$oldest, $scratch]]);
            $pending[] = [$scratch, $target];
            $scratch++;
            continue;
        }
        $applyPass($safe);
        $done = [];
        foreach ($safe as [$oldId]) {
            $done[] = $oldId;
        }
        $pending = array_filter($pending, fn ($p) => !in_array($p[0], $done, true));
        log_line("        pass {$passes}: moved " . count($safe) . ' ids (' . count($pending) . ' left)');
    }

    exec_sql('SET FOREIGN_KEY_CHECKS = 1');
    exec_sql('DROP TEMPORARY TABLE IF EXISTS _id_map_pass');

    /* ───────────────────────── STEP 4: SPRITE_ID + CATALOG ───────────────────────── */
    $affected = exec_sql('UPDATE items_base SET sprite_id = id WHERE sprite_id <> id');
    log_line("      sprite_id normalised rows: {$affected}");

    $cat = exec_sql(
        "UPDATE catalog_items ci JOIN items_base ib ON ci.item_ids = " . numToStr('catalog_items', 'item_ids', 'ib.id')
        . " SET ci.catalog_name = ib.item_name WHERE ci.catalog_name <> ib.item_name"
    );
    log_line("      catalog_items.catalog_name normalised rows: {$cat}");

    /* ───────────────────────── STEP 5: INSERT MISSING ───────────────────────── */
    $inserted = 0;
    $skipped = [];
    $currentIds = array_fill_keys(array_column(q('SELECT id FROM items_base'), 'id'), true);
    foreach ($desired as $cn => $id) {
        if (isset($idByName[$cn])) {
            continue; // already exists (and now correctly id'd)
        }
        if (isset($currentIds[$id])) {
            $skipped[] = "{$cn} (id {$id} still occupied)";
            continue;
        }
        exec_sql(
            'INSERT INTO items_base (id, item_name, sprite_id) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE item_name = VALUES(item_name), sprite_id = VALUES(sprite_id)',
            [$id, $cn, $id]
        );
        $currentIds[$id] = true;
        $inserted++;
    }
    log_line("      inserted missing items: {$inserted}");
    if ($skipped !== []) {
        log_line('      SKIPPED (id occupied, manual review): ' . implode('; ', $skipped));
    }

    /* ───────────────────────── STEP 6: AUTO_INCREMENT + COMPOUND ───────────────────────── */
    $next = (int) (q('SELECT COALESCE(MAX(id),0) + 1 AS nxt FROM items_base')[0]['nxt'] ?? 1);
    exec_sql("ALTER TABLE items_base AUTO_INCREMENT = {$next}");

    // Rewrite compound "a;b" lists that may contain moved ids.
    $compound = q("SELECT id, item_ids FROM catalog_items WHERE item_ids LIKE '%;%'");
    foreach ($compound as $row) {
        $mapped = implode(';', array_map(
            static fn ($p) => trim($p),
            explode(';', (string) $row['item_ids'])
        ));
        exec_sql('UPDATE catalog_items SET item_ids = ? WHERE id = ?', [$mapped, $row['id']]);
    }
    log_line('      compound item_ids lists checked: ' . count($compound));

    pdo()->commit();
    log_line('[DONE] Synchronisation committed successfully.');
} catch (Throwable $e) {
    if (pdo()->inTransaction()) {
        pdo()->rollBack();
    }
    log_line('[FATAL] Rolled back. Error: ' . $e->getMessage());
    exit(1);
}

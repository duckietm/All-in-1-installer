//! The catalogue manager's data: the pages and offers of the hotel catalogue (`catalog_pages`, `catalog_items`), read
//! and changed through the SQL session's SSH tunnel, and the running emulator told to load the catalogue again over
//! its RCON port (`updatecatalog`), which also tells the players online to refresh it.
//!
//! The tables are Polaris's. Every change is one statement with `?` parameters; nothing typed in is put into SQL text.

use crate::server::{Result, Server, ServerError};
use crate::sql_session::{quote, SqlSession, SqlValue};

/// The page layouts Polaris knows (the `page_layout` enum of `catalog_pages`).
pub const LAYOUTS: &[&str] = &[
    "default_3x3",
    "default_3x3_color_grouping",
    "frontpage",
    "frontpage_featured",
    "productpage1",
    "single_bundle",
    "room_bundle",
    "spaces",
    "spaces_new",
    "trophies",
    "plasto",
    "pets",
    "pets2",
    "pets3",
    "petcustomization",
    "bots",
    "badge_display",
    "soundmachine",
    "guilds",
    "guild_furni",
    "guild_forum",
    "club_buy",
    "club_gift",
    "vip_buy",
    "loyalty_vip_buy",
    "info_loyalty",
    "info_duckets",
    "info_rentables",
    "info_pets",
    "roomads",
    "recycler",
    "recycler_info",
    "recycler_prizes",
    "marketplace",
    "marketplace_own_items",
    "sold_ltd_items",
    "recent_purchases",
    "collectibles",
    "recolorable_furniture",
    "builders_club_frontpage",
    "builders_club_addons",
    "builders_club_loyalty",
    "root",
    "monkey",
    "niko",
    "mad_money",
];

/// Which catalogue a page belongs to (`catalog_pages.catalog_mode`).
pub const CATALOG_MODES: &[&str] = &["NORMAL", "BUILDER", "BOTH"];

/// The column sizes of the tables, so a save is refused here instead of cut off by MariaDB.
pub const MAX_CAPTION: usize = 128;
pub const MAX_CAPTION_SAVE: usize = 25;
pub const MAX_CATALOG_NAME: usize = 100;
pub const MAX_ITEM_IDS: usize = 666;
pub const MAX_EXTRADATA: usize = 500;

/// One catalogue page.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Page {
    pub id: i64,
    pub parent_id: i64,
    pub caption: String,
    /// The internal name the client opens a page by (`catalog/open/<name>`).
    pub caption_save: String,
    pub layout: String,
    pub icon_image: i64,
    pub min_rank: i64,
    pub order_num: i64,
    pub visible: bool,
    pub enabled: bool,
    pub club_only: bool,
    pub catalog_mode: String,
}

/// One offer on a page.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Offer {
    pub id: i64,
    pub page_id: i64,
    pub catalog_name: String,
    /// The furni (items_base ids) the offer gives: one id, or several as a bundle ("1;2;3").
    pub item_ids: String,
    pub cost_credits: i64,
    pub cost_points: i64,
    /// The currency of `cost_points` (0 duckets, 5 diamonds, ...).
    pub points_type: i64,
    pub amount: i64,
    /// More than 0 makes it a limited series of that size.
    pub limited_stack: i64,
    pub limited_sells: i64,
    pub order_number: i64,
    pub offer_id: i64,
    pub club_only: bool,
    pub have_offer: bool,
    pub extradata: String,
}

/// A page with how deep it sits in the tree, in the order the tree shows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TreeRow {
    pub index: usize,
    pub depth: usize,
}

const PAGE_COLUMNS: &str =
    "id, parent_id, caption, caption_save, page_layout, icon_image, min_rank, order_num, visible, enabled, club_only, catalog_mode";

const OFFER_COLUMNS: &str = "id, page_id, catalog_name, item_ids, cost_credits, cost_points, points_type, amount, \
     limited_stack, limited_sells, order_number, offer_id, club_only, have_offer, extradata";

fn int(value: Option<&SqlValue>) -> i64 {
    match value {
        Some(SqlValue::Int(v)) => *v,
        Some(SqlValue::UInt(v)) => *v as i64,
        Some(SqlValue::Float(v)) => *v as i64,
        Some(SqlValue::Double(v)) => *v as i64,
        Some(SqlValue::Text(t)) | Some(SqlValue::Decimal(t)) => t.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

fn text(value: Option<&SqlValue>) -> String {
    match value {
        Some(SqlValue::Text(t)) | Some(SqlValue::Decimal(t)) => t.clone(),
        Some(SqlValue::Int(v)) => v.to_string(),
        Some(SqlValue::UInt(v)) => v.to_string(),
        _ => String::new(),
    }
}

/// An `enum('0','1')` column.
fn flag(value: Option<&SqlValue>) -> bool {
    text(value).trim() == "1"
}

fn flag_value(on: bool) -> SqlValue {
    SqlValue::Text(if on { "1" } else { "0" }.into())
}

pub fn page_from_row(row: &[SqlValue]) -> Page {
    Page {
        id: int(row.first()),
        parent_id: int(row.get(1)),
        caption: text(row.get(2)),
        caption_save: text(row.get(3)),
        layout: text(row.get(4)),
        icon_image: int(row.get(5)),
        min_rank: int(row.get(6)),
        order_num: int(row.get(7)),
        visible: flag(row.get(8)),
        enabled: flag(row.get(9)),
        club_only: flag(row.get(10)),
        catalog_mode: text(row.get(11)),
    }
}

pub fn offer_from_row(row: &[SqlValue]) -> Offer {
    Offer {
        id: int(row.first()),
        page_id: int(row.get(1)),
        catalog_name: text(row.get(2)),
        item_ids: text(row.get(3)),
        cost_credits: int(row.get(4)),
        cost_points: int(row.get(5)),
        points_type: int(row.get(6)),
        amount: int(row.get(7)),
        limited_stack: int(row.get(8)),
        limited_sells: int(row.get(9)),
        order_number: int(row.get(10)),
        offer_id: int(row.get(11)),
        club_only: flag(row.get(12)),
        have_offer: flag(row.get(13)),
        extradata: text(row.get(14)),
    }
}

/// The pages in tree order: children under their parent, each level by `order_num` then caption. A page whose parent
/// is missing (or that would loop back to itself) is shown at the top level, so no page is ever hidden.
pub fn tree(pages: &[Page]) -> Vec<TreeRow> {
    use std::collections::{HashMap, HashSet};

    let ids: HashSet<i64> = pages.iter().map(|p| p.id).collect();
    let mut children: HashMap<i64, Vec<usize>> = HashMap::new();
    let mut roots = Vec::new();

    for (index, page) in pages.iter().enumerate() {
        if page.parent_id != page.id && ids.contains(&page.parent_id) {
            children.entry(page.parent_id).or_default().push(index);
        } else {
            roots.push(index);
        }
    }

    let sort = |list: &mut Vec<usize>| {
        list.sort_by(|a, b| {
            let (a, b) = (&pages[*a], &pages[*b]);
            a.order_num.cmp(&b.order_num).then_with(|| a.caption.to_lowercase().cmp(&b.caption.to_lowercase())).then(a.id.cmp(&b.id))
        })
    };
    sort(&mut roots);
    for list in children.values_mut() {
        sort(list);
    }

    let mut rows = Vec::with_capacity(pages.len());
    let mut seen = HashSet::new();
    let mut stack: Vec<(usize, usize)> = roots.into_iter().rev().map(|index| (index, 0)).collect();

    while let Some((index, depth)) = stack.pop() {
        if !seen.insert(index) {
            continue;
        }
        rows.push(TreeRow { index, depth });
        if let Some(list) = children.get(&pages[index].id) {
            stack.extend(list.iter().rev().map(|child| (*child, depth + 1)));
        }
    }

    // Pages in a loop (a parent of its own parent) never hang off a root: put them at the top level.
    for index in 0..pages.len() {
        if !seen.contains(&index) {
            seen.insert(index);
            rows.push(TreeRow { index, depth: 0 });
        }
    }

    rows
}

/// Whether `ancestor` is `page` or above it in the tree: a page may not be moved under itself.
pub fn is_ancestor(pages: &[Page], ancestor: i64, page: i64) -> bool {
    let mut current = page;
    for _ in 0..=pages.len() {
        if current == ancestor {
            return true;
        }
        match pages.iter().find(|p| p.id == current) {
            Some(p) if p.parent_id != current => current = p.parent_id,
            _ => return false,
        }
    }
    false
}

/// Why the page cannot be saved as it is, or None.
pub fn page_problem(page: &Page, pages: &[Page]) -> Option<String> {
    if page.caption.trim().is_empty() {
        return Some("The page needs a name.".into());
    }
    if page.caption.chars().count() > MAX_CAPTION {
        return Some(format!("The name is longer than {MAX_CAPTION} characters."));
    }
    if page.caption_save.chars().count() > MAX_CAPTION_SAVE {
        return Some(format!("The internal name is longer than {MAX_CAPTION_SAVE} characters."));
    }
    if !LAYOUTS.contains(&page.layout.as_str()) {
        return Some(format!("Unknown layout: {}", page.layout));
    }
    if !CATALOG_MODES.contains(&page.catalog_mode.as_str()) {
        return Some(format!("Unknown catalogue: {}", page.catalog_mode));
    }
    if page.parent_id != -1 && page.id > 0 && is_ancestor(pages, page.id, page.parent_id) {
        return Some("A page cannot be put under itself.".into());
    }
    if page.parent_id != -1 && !pages.iter().any(|p| p.id == page.parent_id) {
        return Some(format!("There is no page {} to put it under.", page.parent_id));
    }
    if page.min_rank < 0 || page.icon_image < 0 {
        return Some("The rank and the icon cannot be negative.".into());
    }
    None
}

/// The furni ids of an offer's `item_ids` ("1;2;3" or "1:2" for a bundle with amounts), or None when it is not that.
pub fn item_ids(value: &str) -> Option<Vec<i64>> {
    let mut ids = Vec::new();
    for part in value.split(';').map(str::trim).filter(|p| !p.is_empty()) {
        let id = part.split(':').next().unwrap_or("").trim().parse::<i64>().ok().filter(|id| *id > 0)?;
        if let Some(amount) = part.split(':').nth(1) {
            amount.trim().parse::<i64>().ok().filter(|a| *a > 0)?;
        }
        ids.push(id);
    }
    (!ids.is_empty()).then_some(ids)
}

/// Why the offer cannot be saved as it is, or None. Selling fewer than already sold of a limited series is refused,
/// as the emulator keeps the numbers it made.
pub fn offer_problem(offer: &Offer) -> Option<String> {
    if offer.catalog_name.trim().is_empty() {
        return Some("The offer needs a name.".into());
    }
    if offer.catalog_name.chars().count() > MAX_CATALOG_NAME {
        return Some(format!("The name is longer than {MAX_CATALOG_NAME} characters."));
    }
    if offer.item_ids.len() > MAX_ITEM_IDS || item_ids(&offer.item_ids).is_none() {
        return Some("The furni ids must be numbers, separated by ; (for example 1234 or 100;200).".into());
    }
    if offer.extradata.len() > MAX_EXTRADATA {
        return Some(format!("The extra data is longer than {MAX_EXTRADATA} characters."));
    }
    if offer.cost_credits < 0 || offer.cost_points < 0 || offer.points_type < 0 {
        return Some("Prices cannot be negative.".into());
    }
    if offer.amount < 1 {
        return Some("The amount must be at least 1.".into());
    }
    if offer.limited_stack < 0 {
        return Some("The limited size cannot be negative.".into());
    }
    if offer.limited_stack > 0 && offer.limited_stack < offer.limited_sells {
        return Some(format!("{} are sold already: the limited size cannot be smaller.", offer.limited_sells));
    }
    None
}

/// `SELECT` of every page of the hotel database.
pub fn pages_sql(database: &str) -> String {
    format!("SELECT {PAGE_COLUMNS} FROM {}.catalog_pages ORDER BY parent_id, order_num, id", quote(database))
}

/// `SELECT` of the offers of one page (`?` = the page id).
pub fn offers_sql(database: &str) -> String {
    format!("SELECT {OFFER_COLUMNS} FROM {}.catalog_items WHERE page_id = ? ORDER BY order_number, id", quote(database))
}

pub fn update_page_sql(database: &str) -> String {
    format!(
        "UPDATE {}.catalog_pages SET parent_id = ?, caption = ?, caption_save = ?, page_layout = ?, icon_image = ?, min_rank = ?, \
         order_num = ?, visible = ?, enabled = ?, club_only = ?, catalog_mode = ? WHERE id = ?",
        quote(database)
    )
}

pub fn update_page_params(page: &Page) -> Vec<SqlValue> {
    vec![
        SqlValue::Int(page.parent_id),
        SqlValue::Text(page.caption.trim().to_string()),
        SqlValue::Text(page.caption_save.trim().to_string()),
        SqlValue::Text(page.layout.clone()),
        SqlValue::Int(page.icon_image),
        SqlValue::Int(page.min_rank),
        SqlValue::Int(page.order_num),
        flag_value(page.visible),
        flag_value(page.enabled),
        flag_value(page.club_only),
        SqlValue::Text(page.catalog_mode.clone()),
        SqlValue::Int(page.id),
    ]
}

pub fn update_offer_sql(database: &str) -> String {
    format!(
        "UPDATE {}.catalog_items SET page_id = ?, catalog_name = ?, item_ids = ?, cost_credits = ?, cost_points = ?, points_type = ?, \
         amount = ?, limited_stack = ?, order_number = ?, offer_id = ?, club_only = ?, have_offer = ?, extradata = ? WHERE id = ?",
        quote(database)
    )
}

pub fn update_offer_params(offer: &Offer) -> Vec<SqlValue> {
    vec![
        SqlValue::Int(offer.page_id),
        SqlValue::Text(offer.catalog_name.trim().to_string()),
        SqlValue::Text(offer.item_ids.trim().to_string()),
        SqlValue::Int(offer.cost_credits),
        SqlValue::Int(offer.cost_points),
        SqlValue::Int(offer.points_type),
        SqlValue::Int(offer.amount),
        SqlValue::Int(offer.limited_stack),
        SqlValue::Int(offer.order_number),
        SqlValue::Int(offer.offer_id),
        flag_value(offer.club_only),
        flag_value(offer.have_offer),
        SqlValue::Text(offer.extradata.clone()),
        SqlValue::Int(offer.id),
    ]
}

pub fn insert_page_sql(database: &str) -> String {
    format!(
        "INSERT INTO {}.catalog_pages (parent_id, caption, caption_save, page_layout, icon_image, min_rank, order_num, visible, enabled, \
         club_only, catalog_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        quote(database)
    )
}

/// The values of [`update_page_params`] without the id at the end.
pub fn insert_page_params(page: &Page) -> Vec<SqlValue> {
    let mut params = update_page_params(page);
    params.pop();
    params
}

pub fn insert_offer_sql(database: &str) -> String {
    format!(
        "INSERT INTO {}.catalog_items (page_id, catalog_name, item_ids, cost_credits, cost_points, points_type, amount, limited_stack, \
         order_number, offer_id, club_only, have_offer, extradata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        quote(database)
    )
}

/// The values of [`update_offer_params`] without the id at the end.
pub fn insert_offer_params(offer: &Offer) -> Vec<SqlValue> {
    let mut params = update_offer_params(offer);
    params.pop();
    params
}

/// A new page under `parent_id` (-1: the top level), after the pages already there; not saved yet (id 0).
pub fn new_page(pages: &[Page], parent_id: i64) -> Page {
    let order_num = pages.iter().filter(|p| p.parent_id == parent_id).map(|p| p.order_num).max().map_or(1, |o| o + 1);
    Page {
        id: 0,
        parent_id,
        caption: "New page".into(),
        caption_save: String::new(),
        layout: "default_3x3".into(),
        icon_image: 1,
        min_rank: 1,
        order_num,
        visible: false,
        enabled: true,
        club_only: false,
        catalog_mode: "NORMAL".into(),
    }
}

/// A new offer on the page, after the offers already there; not saved yet (id 0). The furni ids are left to fill in.
pub fn new_offer(offers: &[Offer], page_id: i64) -> Offer {
    let order_number = offers.iter().map(|o| o.order_number).max().map_or(1, |o| o + 1);
    Offer {
        id: 0,
        page_id,
        catalog_name: String::new(),
        item_ids: String::new(),
        cost_credits: 3,
        amount: 1,
        order_number,
        offer_id: -1,
        have_offer: true,
        ..Offer::default()
    }
}

/// Why the page cannot be deleted, or None. Its sub-pages go first (they would lose their place in the tree), and an
/// offer with limited sales keeps the record of who has which number.
pub fn page_delete_problem(pages: &[Page], offers: &[Offer], id: i64) -> Option<String> {
    let children = pages.iter().filter(|p| p.parent_id == id && p.id != id).count();
    if children > 0 {
        return Some(format!("The page has {children} sub-pages: move or delete them first."));
    }
    offers.iter().find(|o| o.page_id == id && o.limited_sells > 0).map(|o| {
        format!("The offer {} sold {} limited numbers: it cannot be deleted.", o.catalog_name, o.limited_sells)
    })
}

/// Why the offer cannot be deleted, or None: its limited sales would be lost.
pub fn offer_delete_problem(offer: &Offer) -> Option<String> {
    (offer.limited_sells > 0).then(|| format!("{} limited numbers are sold: the offer cannot be deleted.", offer.limited_sells))
}

/// Every page of the hotel database.
pub async fn load_pages(session: &SqlSession, database: &str) -> Result<Vec<Page>> {
    let rows = session.select(&pages_sql(database), Vec::new()).await?;
    Ok(rows.iter().map(|row| page_from_row(row)).collect())
}

/// The offers of one page.
pub async fn load_offers(session: &SqlSession, database: &str, page_id: i64) -> Result<Vec<Offer>> {
    let rows = session.select(&offers_sql(database), vec![SqlValue::Int(page_id)]).await?;
    Ok(rows.iter().map(|row| offer_from_row(row)).collect())
}

/// Saves the page; a new one (id 0) is added. Returns its id.
pub async fn save_page(session: &SqlSession, database: &str, page: &Page) -> Result<i64> {
    if page.id <= 0 {
        let (_, id) = session.execute(&[(insert_page_sql(database), insert_page_params(page))]).await?;
        return Ok(id as i64);
    }
    session.execute(&[(update_page_sql(database), update_page_params(page))]).await?;
    Ok(page.id)
}

/// Saves the offer; a new one (id 0) is added. Returns its id.
pub async fn save_offer(session: &SqlSession, database: &str, offer: &Offer) -> Result<i64> {
    if offer.id <= 0 {
        let (_, id) = session.execute(&[(insert_offer_sql(database), insert_offer_params(offer))]).await?;
        return Ok(id as i64);
    }
    session.execute(&[(update_offer_sql(database), update_offer_params(offer))]).await?;
    Ok(offer.id)
}

/// Deletes the page with its offers, in one transaction. Check [`page_delete_problem`] first.
pub async fn delete_page(session: &SqlSession, database: &str, id: i64) -> Result<u64> {
    let db = quote(database);
    let statements = vec![
        (format!("DELETE FROM {db}.catalog_items WHERE page_id = ?"), vec![SqlValue::Int(id)]),
        (format!("DELETE FROM {db}.catalog_pages WHERE id = ?"), vec![SqlValue::Int(id)]),
    ];
    Ok(session.execute(&statements).await?.0)
}

/// Deletes the offer. Check [`offer_delete_problem`] first.
pub async fn delete_offer(session: &SqlSession, database: &str, id: i64) -> Result<u64> {
    let statements = vec![(format!("DELETE FROM {}.catalog_items WHERE id = ?", quote(database)), vec![SqlValue::Int(id)])];
    Ok(session.execute(&statements).await?.0)
}

/// The script that finds the hotel database the emulator uses (config.ini) and prints its name.
pub fn database_script() -> String {
    format!("{}\nprintf '%s\\n' \"$db\"\n", crate::server_tools::database_name())
}

/// The hotel database the emulator on the server uses.
pub async fn hotel_database(server: &dyn Server) -> Result<String> {
    let result = server.run_as_root(&database_script()).await?;
    let name = result.output.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("").to_string();
    if !result.succeeded() || name.is_empty() {
        return Err(ServerError("Could not find the hotel database in the emulator's config.ini.".into()).into());
    }
    Ok(name)
}

/// The RCON request that makes the emulator load the catalogue again and tell the players online.
pub const RELOAD_REQUEST: &str = r#"{"key":"updatecatalog","data":{}}"#;

/// Sends [`RELOAD_REQUEST`] to the emulator's RCON port (config.ini `rcon.port`, default 3001) on 127.0.0.1 of the
/// server, and prints the answer.
pub fn reload_script() -> String {
    format!(
        r#"port=$(grep -sE '^rcon.port=' {dir}/config.ini | cut -d= -f2 | tr -d '[:space:]') || true
port=${{port:-3001}}
printf '%s' '{request}' | timeout 20 bash -c "exec 3<>/dev/tcp/127.0.0.1/$port && cat >&3 && cat <&3"
"#,
        dir = crate::emulator::directory(),
        request = RELOAD_REQUEST
    )
}

/// Whether the emulator's RCON answer says the request worked (`"status":0`).
pub fn reload_succeeded(answer: &str) -> bool {
    let compact: String = answer.chars().filter(|c| !c.is_whitespace()).collect();
    compact.contains("\"status\":0")
}

/// Makes the running emulator load the catalogue again; the players online are told to refresh it.
pub async fn reload_catalog(server: &dyn Server) -> Result<()> {
    let result = server.run_as_root(&reload_script()).await?;
    if result.succeeded() && reload_succeeded(&result.output) {
        return Ok(());
    }
    let detail = if result.output.trim().is_empty() { result.error.trim().to_string() } else { result.output.trim().to_string() };
    Err(ServerError(format!(
        "The emulator did not reload the catalogue (is it running, and is RCON on 127.0.0.1?): {}",
        if detail.is_empty() { "no answer".to_string() } else { detail }
    ))
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(id: i64, parent_id: i64, caption: &str, order_num: i64) -> Page {
        Page {
            id,
            parent_id,
            caption: caption.into(),
            layout: "default_3x3".into(),
            catalog_mode: "NORMAL".into(),
            order_num,
            visible: true,
            enabled: true,
            ..Page::default()
        }
    }

    fn offer() -> Offer {
        Offer { id: 1, page_id: 5, catalog_name: "throne".into(), item_ids: "230".into(), amount: 1, ..Offer::default() }
    }

    #[test]
    fn the_tree_puts_children_under_their_parent_in_order() {
        let pages = vec![page(1, -1, "Shop", 2), page(2, -1, "Front", 1), page(3, 1, "Rares", 1), page(4, 1, "Alpha", 1), page(5, 3, "Old", 0)];
        let rows: Vec<(i64, usize)> = tree(&pages).iter().map(|r| (pages[r.index].id, r.depth)).collect();

        assert_eq!(rows, vec![(2, 0), (1, 0), (4, 1), (3, 1), (5, 2)]);
    }

    #[test]
    fn a_page_without_its_parent_or_in_a_loop_still_shows() {
        let pages = vec![page(1, 99, "Lost", 0), page(2, 3, "A", 0), page(3, 2, "B", 0), page(4, 4, "Self", 0)];
        let mut ids: Vec<i64> = tree(&pages).iter().map(|r| pages[r.index].id).collect();
        ids.sort();

        assert_eq!(ids, vec![1, 2, 3, 4]);
    }

    #[test]
    fn a_page_cannot_go_under_itself() {
        let pages = vec![page(1, -1, "Shop", 0), page(2, 1, "Rares", 0), page(3, 2, "Old", 0)];
        let mut moved = pages[0].clone();
        moved.parent_id = 3;

        assert!(is_ancestor(&pages, 1, 3));
        assert!(!is_ancestor(&pages, 3, 1));
        assert_eq!(page_problem(&moved, &pages), Some("A page cannot be put under itself.".into()));
        assert_eq!(page_problem(&pages[2], &pages), None);
    }

    #[test]
    fn a_page_needs_a_known_layout_and_a_name() {
        let pages = vec![page(1, -1, "Shop", 0)];
        let mut p = pages[0].clone();
        p.layout = "nope".into();
        assert_eq!(page_problem(&p, &pages), Some("Unknown layout: nope".into()));
        p.layout = "frontpage".into();
        p.caption = " ".into();
        assert_eq!(page_problem(&p, &pages), Some("The page needs a name.".into()));
        p.caption = "Shop".into();
        p.parent_id = 7;
        assert_eq!(page_problem(&p, &pages), Some("There is no page 7 to put it under.".into()));
    }

    #[test]
    fn item_ids_are_numbers_or_bundles() {
        assert_eq!(item_ids("230"), Some(vec![230]));
        assert_eq!(item_ids("100;200; 300"), Some(vec![100, 200, 300]));
        assert_eq!(item_ids("100:2;200"), Some(vec![100, 200]));
        assert_eq!(item_ids(""), None);
        assert_eq!(item_ids("abc"), None);
        assert_eq!(item_ids("0"), None);
        assert_eq!(item_ids("5:0"), None);
    }

    #[test]
    fn an_offer_keeps_its_limited_sales() {
        assert_eq!(offer_problem(&offer()), None);
        let mut o = offer();
        o.limited_stack = 10;
        o.limited_sells = 12;
        assert_eq!(offer_problem(&o), Some("12 are sold already: the limited size cannot be smaller.".into()));
        o.limited_stack = 12;
        assert_eq!(offer_problem(&o), None);
        o.amount = 0;
        assert_eq!(offer_problem(&o), Some("The amount must be at least 1.".into()));
        let mut bad = offer();
        bad.item_ids = "x".into();
        assert!(offer_problem(&bad).is_some());
    }

    #[test]
    fn rows_turn_into_pages_and_offers() {
        let row = vec![
            SqlValue::Int(5),
            SqlValue::Int(-1),
            SqlValue::Text("Rares".into()),
            SqlValue::Text("rares".into()),
            SqlValue::Text("default_3x3".into()),
            SqlValue::Int(3),
            SqlValue::Int(1),
            SqlValue::Int(2),
            SqlValue::Text("1".into()),
            SqlValue::Text("0".into()),
            SqlValue::Text("0".into()),
            SqlValue::Text("NORMAL".into()),
        ];
        let p = page_from_row(&row);
        assert_eq!((p.id, p.parent_id, p.caption.as_str(), p.visible, p.enabled), (5, -1, "Rares", true, false));
        assert_eq!(update_page_params(&p).len(), update_page_sql("hotel").matches('?').count());
        assert_eq!(update_offer_params(&offer()).len(), update_offer_sql("hotel").matches('?').count());
        assert!(pages_sql("my`db").contains("`my``db`.catalog_pages"));
    }

    #[test]
    fn new_pages_and_offers_go_after_the_others() {
        let pages = vec![page(1, -1, "Shop", 4), page(2, 1, "Rares", 7), page(3, 1, "Old", 2)];
        let new = new_page(&pages, 1);
        assert_eq!((new.id, new.parent_id, new.order_num, new.visible), (0, 1, 8, false));
        assert_eq!(new_page(&pages, -1).order_num, 5);
        assert_eq!(new_page(&[], -1).order_num, 1);
        assert_eq!(page_problem(&new, &pages), None);

        let mut first = offer();
        first.order_number = 3;
        let made = new_offer(&[first], 5);
        assert_eq!((made.id, made.page_id, made.order_number, made.amount), (0, 5, 4, 1));
        assert!(offer_problem(&made).is_some(), "the furni ids still have to be filled in");
        assert_eq!(insert_page_params(&new).len(), insert_page_sql("hotel").matches('?').count());
        assert_eq!(insert_offer_params(&made).len(), insert_offer_sql("hotel").matches('?').count());
    }

    #[test]
    fn deleting_keeps_sub_pages_and_limited_sales() {
        let pages = vec![page(1, -1, "Shop", 0), page(2, 1, "Rares", 0)];
        let mut sold = offer();
        sold.page_id = 2;
        sold.limited_stack = 10;
        sold.limited_sells = 3;

        assert_eq!(page_delete_problem(&pages, &[], 1), Some("The page has 1 sub-pages: move or delete them first.".into()));
        assert_eq!(page_delete_problem(&pages, &[offer()], 2), None);
        assert!(page_delete_problem(&pages, std::slice::from_ref(&sold), 2).is_some());
        assert_eq!(offer_delete_problem(&offer()), None);
        assert_eq!(offer_delete_problem(&sold), Some("3 limited numbers are sold: the offer cannot be deleted.".into()));
    }

    #[test]
    fn the_reload_asks_the_emulator_over_rcon() {
        let script = reload_script();
        assert!(script.contains(RELOAD_REQUEST));
        assert!(script.contains("/dev/tcp/127.0.0.1/$port"));
        assert!(reload_succeeded(r#"{"status":0,"message":""}"#));
        assert!(reload_succeeded("{ \"status\" : 0 }"));
        assert!(!reload_succeeded(r#"{"status":1,"message":"invalid request"}"#));
        assert!(!reload_succeeded(""));
    }
}

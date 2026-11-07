//! The catalogue manager: the hotel catalogue's pages as a tree, a page's settings and offers, and an offer's
//! settings, edited in the hotel database through the SSH session (the SQL Editor's tunnel and MariaDB login).
//! **Publish** makes the running emulator load the catalogue again (RCON `updatecatalog`), which tells the players
//! online to refresh it. The data and its rules live in `aio_remote::catalog_admin`.

use std::sync::{Arc, Mutex};

use aio_remote::catalog_admin::{self, Offer, Page, TreeRow, CATALOG_MODES, LAYOUTS};
use aio_remote::sql_session::SqlSession;
use aio_remote::Server;
use eframe::egui::{self, RichText};

use super::sql_editor::login::{Login, Prompt};
use super::sql_editor::text;
use crate::gui::dialogs::Choice;
use crate::gui::icons::{self, Icon};
use crate::gui::theme::{Fixed, Palette};
use crate::gui::{widgets, Page as AppPage, Request, Shared, View};
use crate::i18n::{t, tf};

#[derive(Default, Clone)]
struct Status {
    text: String,
    error: bool,
}

impl Status {
    fn ok(text: String) -> Self {
        Status { text, error: false }
    }

    fn error(text: String) -> Self {
        Status { text, error: true }
    }
}

#[derive(Default)]
struct State {
    /// Raised when the session closes: an older task changes nothing.
    generation: u64,
    session: Option<Arc<SqlSession>>,
    session_for: Option<usize>,
    opening: bool,
    prompt: Option<Prompt>,
    login_visible: bool,
    database: String,
    subtitle: String,
    pages: Vec<Page>,
    rows: Vec<TreeRow>,
    search: String,
    /// The page shown, as loaded, and as edited.
    page: Option<Page>,
    page_edit: Option<Page>,
    offers: Vec<Offer>,
    offer: Option<Offer>,
    offer_edit: Option<Offer>,
    busy: bool,
    /// Saved since the last publish: the hotel still shows the old catalogue.
    unpublished: bool,
    status: Status,
}

impl State {
    fn close(&mut self, shared: &Shared) {
        self.generation += 1;
        if let Some(session) = self.session.take() {
            shared.spawn(async move {
                if let Ok(session) = Arc::try_unwrap(session) {
                    session.close().await;
                }
            });
        }
        let generation = self.generation;
        *self = State { generation, ..State::default() };
    }

    fn set_pages(&mut self, pages: Vec<Page>) {
        self.rows = catalog_admin::tree(&pages);
        self.pages = pages;
    }
}

pub struct CatalogManagerView {
    state: Arc<Mutex<State>>,
}

#[derive(Clone)]
struct Ctl {
    state: Arc<Mutex<State>>,
    shared: Shared,
}

fn server_id(server: &Arc<dyn Server>) -> usize {
    Arc::as_ptr(server) as *const () as usize
}

impl Ctl {
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap()
    }

    fn with<R>(&self, generation: u64, change: impl FnOnce(&mut State) -> R) -> Option<R> {
        let result = {
            let mut state = self.lock();
            (state.generation == generation).then(|| change(&mut state))
        };
        self.shared.ctx.request_repaint();
        result
    }

    fn session(&self) -> Option<(u64, Arc<SqlSession>, String)> {
        let state = self.lock();
        state.session.clone().map(|s| (state.generation, s, state.database.clone()))
    }

    fn spawn<F: std::future::Future<Output = ()> + Send + 'static>(&self, task: impl FnOnce(Ctl) -> F) {
        self.shared.spawn(task(self.clone()));
    }

    /// Finds the hotel database, logs in to MariaDB like the SQL Editor (the saved root account, or asks), and
    /// loads the pages.
    async fn open(self, ask_first: bool) {
        let Some(server) = self.shared.session() else { return };
        let generation = {
            let mut state = self.lock();
            if state.opening {
                return;
            }
            state.opening = true;
            state.generation
        };
        self.open_inner(server, ask_first, generation).await;
        self.with(generation, |s| s.opening = false);
    }

    async fn open_inner(&self, server: Arc<dyn Server>, ask_first: bool, generation: u64) {
        if server.is_dry_run() {
            self.with(generation, |s| s.status = Status::error(t("Dry run: there is no MariaDB to connect to.").into()));
            return;
        }
        self.with(generation, |s| s.subtitle = t("Looking for the hotel database ...").into());
        let database = match catalog_admin::hotel_database(&*server).await {
            Ok(database) => database,
            Err(error) => {
                self.with(generation, |s| s.status = Status::error(error.to_string()));
                return;
            }
        };
        let host = server.login().host.clone();
        let saved = aio_core::config_dir::load_database_credentials(&host);
        let mut login = Login {
            user: saved.as_ref().map(|s| s.root_user.clone()).filter(|u| !u.is_empty()).unwrap_or_else(|| "root".into()),
            password: saved.as_ref().map(|s| s.root_password.clone()).unwrap_or_default(),
            port: saved.as_ref().map(|s| s.port).filter(|p| *p > 0).unwrap_or(3306),
        };
        let mut problem = saved.is_none().then(|| t("No saved MariaDB password for this server on this computer: enter an account.").to_string());
        let mut ask = ask_first || saved.is_none();
        let session = loop {
            if ask {
                let (prompt, answer) = Prompt::new(&host, &login, problem.take());
                if self.with(generation, |s| s.prompt = Some(prompt)).is_none() {
                    return;
                }
                match answer.await.ok().flatten() {
                    Some(entered) => login = entered,
                    None => {
                        self.with(generation, |s| {
                            s.login_visible = true;
                            s.subtitle = t("Not logged in to MariaDB. Click Log in to MariaDB.").into();
                        });
                        return;
                    }
                }
            }
            self.with(generation, |s| s.subtitle = tf("Connecting to MariaDB as {user} ...", &[("user", &login.user)]));
            match SqlSession::open(&*server, &login.user, &login.password, login.port).await {
                Ok(session) => break session,
                Err(error) => {
                    let message = error.to_string();
                    problem = Some(if text::is_access_denied(&message) {
                        tf("MariaDB refused {user}: {message}", &[("user", &login.user), ("message", &message)])
                    } else {
                        tf("Could not reach MariaDB on 127.0.0.1:{port} of the server: {message}", &[("port", &login.port.to_string()), ("message", &message)])
                    });
                    ask = true;
                }
            }
        };
        let session = Arc::new(session);
        let subtitle = tf("The catalogue of {database} on {host}, through the SSH tunnel.", &[("database", &database), ("host", &host)]);
        let kept = self.with(generation, |s| {
            s.session = Some(session.clone());
            s.database = database.clone();
            s.login_visible = false;
            s.subtitle = subtitle;
        });
        if kept.is_none() {
            if let Ok(session) = Arc::try_unwrap(session) {
                session.close().await;
            }
            return;
        }
        drop(session);
        self.load_pages(None).await;
    }

    async fn load_pages(&self, select: Option<i64>) {
        let Some((generation, session, database)) = self.session() else { return };
        self.with(generation, |s| s.busy = true);
        let loaded = catalog_admin::load_pages(&session, &database).await;
        let selected = self.with(generation, |s| {
            s.busy = false;
            match loaded {
                Ok(pages) => {
                    s.status = Status::ok(tf("{count} pages.", &[("count", &pages.len().to_string())]));
                    s.set_pages(pages);
                    select.or(s.page.as_ref().map(|p| p.id))
                }
                Err(error) => {
                    s.status = Status::error(error.to_string());
                    None
                }
            }
        });
        if let Some(Some(id)) = selected {
            self.select_page(id).await;
        }
    }

    async fn select_page(&self, id: i64) {
        let Some((generation, session, database)) = self.session() else { return };
        let page = {
            let s = self.lock();
            s.pages.iter().find(|p| p.id == id).cloned()
        };
        let Some(page) = page else { return };
        self.with(generation, |s| {
            s.page = Some(page.clone());
            s.page_edit = Some(page.clone());
            s.offers.clear();
            s.offer = None;
            s.offer_edit = None;
            s.busy = true;
        });
        let offers = catalog_admin::load_offers(&session, &database, id).await;
        self.with(generation, |s| {
            s.busy = false;
            if s.page.as_ref().map(|p| p.id) != Some(id) {
                return;
            }
            match offers {
                Ok(offers) => s.offers = offers,
                Err(error) => s.status = Status::error(error.to_string()),
            }
        });
    }

    async fn save_page(self) {
        let Some((generation, session, database)) = self.session() else { return };
        let Some(page) = self.lock().page_edit.clone() else { return };
        self.with(generation, |s| s.busy = true);
        let saved = catalog_admin::save_page(&session, &database, &page).await;
        let id = self.with(generation, |s| {
            s.busy = false;
            match saved {
                Ok(id) => {
                    s.unpublished = true;
                    s.status = Status::ok(tf("Page {name} saved. Publish to show it in the hotel.", &[("name", &page.caption)]));
                    Some(id)
                }
                Err(error) => {
                    s.status = Status::error(error.to_string());
                    None
                }
            }
        });
        if let Some(Some(id)) = id {
            self.with(generation, |s| s.page = None);
            self.load_pages(Some(id)).await;
        }
    }

    async fn save_offer(self) {
        let Some((generation, session, database)) = self.session() else { return };
        let Some(offer) = self.lock().offer_edit.clone() else { return };
        self.with(generation, |s| s.busy = true);
        let saved = catalog_admin::save_offer(&session, &database, &offer).await;
        let result = self.with(generation, |s| {
            s.busy = false;
            let id = match saved {
                Ok(id) => {
                    s.unpublished = true;
                    s.status = Status::ok(tf("Offer {name} saved. Publish to show it in the hotel.", &[("name", &offer.catalog_name)]));
                    Some(id)
                }
                Err(error) => {
                    s.status = Status::error(error.to_string());
                    None
                }
            };
            (id, s.page.as_ref().map(|p| p.id))
        });
        if let Some((Some(offer_id), Some(page_id))) = result {
            self.select_page(page_id).await;
            self.with(generation, |s| {
                if let Some(found) = s.offers.iter().find(|o| o.id == offer_id).cloned() {
                    s.offer = Some(found.clone());
                    s.offer_edit = Some(found);
                }
            });
        }
    }

    /// Asks first, then deletes the page shown with its offers.
    async fn delete_page(self) {
        let Some((generation, session, database)) = self.session() else { return };
        let (page, problem, offers) = {
            let s = self.lock();
            let Some(page) = s.page.clone().filter(|p| p.id > 0) else { return };
            (page.clone(), catalog_admin::page_delete_problem(&s.pages, &s.offers, page.id), s.offers.len())
        };
        if let Some(problem) = problem {
            self.with(generation, |s| s.status = Status::error(problem));
            return;
        }
        let message = tf("The page {name} and its {count} offers are deleted from the database. This cannot be undone.", &[("name", &page.caption), ("count", &offers.to_string())]);
        let options = vec![Choice::new(t("Delete the page"), t("Delete it and its offers."), true).primary(), Choice::new(t("Cancel"), t("Keep the page."), false)];
        if !self.shared.dialogs.choose(t("Are you sure?"), &tf("Delete {name}?", &[("name", &page.caption)]), &message, false, options).await {
            return;
        }
        self.with(generation, |s| s.busy = true);
        let deleted = catalog_admin::delete_page(&session, &database, page.id).await;
        self.with(generation, |s| {
            s.busy = false;
            match deleted {
                Ok(_) => {
                    s.unpublished = true;
                    s.page = None;
                    s.page_edit = None;
                    s.offers.clear();
                    s.offer = None;
                    s.offer_edit = None;
                    s.status = Status::ok(tf("Page {name} deleted. Publish to take it out of the hotel.", &[("name", &page.caption)]));
                }
                Err(error) => s.status = Status::error(error.to_string()),
            }
        });
        self.load_pages(None).await;
    }

    /// Asks first, then deletes the offer shown.
    async fn delete_offer(self) {
        let Some((generation, session, database)) = self.session() else { return };
        let Some(offer) = self.lock().offer.clone().filter(|o| o.id > 0) else { return };
        if let Some(problem) = catalog_admin::offer_delete_problem(&offer) {
            self.with(generation, |s| s.status = Status::error(problem));
            return;
        }
        let options = vec![Choice::new(t("Delete the offer"), t("Take it off the page for good."), true).primary(), Choice::new(t("Cancel"), t("Keep the offer."), false)];
        let message = t("The offer is deleted from the database. Furni players already bought stays theirs. This cannot be undone.");
        if !self.shared.dialogs.choose(t("Are you sure?"), &tf("Delete {name}?", &[("name", &offer.catalog_name)]), message, false, options).await {
            return;
        }
        self.with(generation, |s| s.busy = true);
        let deleted = catalog_admin::delete_offer(&session, &database, offer.id).await;
        let page_id = self.with(generation, |s| {
            s.busy = false;
            match deleted {
                Ok(_) => {
                    s.unpublished = true;
                    s.status = Status::ok(tf("Offer {name} deleted. Publish to take it out of the hotel.", &[("name", &offer.catalog_name)]));
                }
                Err(error) => s.status = Status::error(error.to_string()),
            }
            s.page.as_ref().map(|p| p.id)
        });
        if let Some(Some(page_id)) = page_id {
            self.select_page(page_id).await;
        }
    }

    async fn publish(self) {
        let Some(server) = self.shared.session() else { return };
        let generation = self.lock().generation;
        self.with(generation, |s| {
            s.busy = true;
            s.status = Status::ok(t("Asking the emulator to load the catalogue again ...").into());
        });
        let result = catalog_admin::reload_catalog(&*server).await;
        self.with(generation, |s| {
            s.busy = false;
            match result {
                Ok(()) => {
                    s.unpublished = false;
                    s.status = Status::ok(t("Published: the emulator loaded the catalogue again and the players online were told to refresh it.").into());
                }
                Err(error) => s.status = Status::error(error.to_string()),
            }
        });
    }
}

impl CatalogManagerView {
    pub fn new(_shared: &Shared) -> Self {
        Self { state: Arc::new(Mutex::new(State::default())) }
    }

    fn ctl(&self, shared: &Shared) -> Ctl {
        Ctl { state: self.state.clone(), shared: shared.clone() }
    }

    fn connect_if_needed(&mut self, shared: &Shared) {
        let Some(server) = shared.session() else { return };
        let id = server_id(&server);
        {
            let mut state = self.state.lock().unwrap();
            if state.session_for == Some(id) {
                return;
            }
            state.close(shared);
            state.session_for = Some(id);
        }
        self.ctl(shared).spawn(|ctl| ctl.open(false));
    }
}

enum Action {
    Login,
    Refresh,
    SelectPage(i64),
    SavePage,
    SaveOffer,
    DeletePage,
    DeleteOffer,
    Publish,
}

fn frame(palette: &Palette) -> egui::Frame {
    widgets::card_frame(palette).inner_margin(10).corner_radius(10)
}

fn small(text: &str) -> egui::Button<'static> {
    egui::Button::new(RichText::new(text.to_string()).size(12.5)).corner_radius(8).min_size(egui::vec2(0.0, 28.0))
}

impl View for CatalogManagerView {
    fn show(&mut self, ui: &mut egui::Ui, palette: &Palette, shared: &Shared) {
        self.connect_if_needed(shared);
        let ctx = ui.ctx().clone();
        let mut actions = Vec::new();
        {
            let mut guard = self.state.lock().unwrap();
            let s = &mut *guard;
            if let Some(prompt) = s.prompt.as_mut() {
                if prompt.show(&ctx, palette) {
                    s.prompt = None;
                }
            }
            egui::Frame::new().inner_margin(egui::Margin { left: 0, right: 0, top: 0, bottom: 18 }).show(ui, |ui| {
                ui.set_min_size(ui.available_size());
                header(ui, palette, s, shared, &mut actions);
                ui.add_space(10.0);
                body(ui, palette, s, &mut actions);
            });
        }
        let ctl = self.ctl(shared);
        for action in actions {
            match action {
                Action::Login => ctl.spawn(|c| c.open(true)),
                Action::Refresh => ctl.spawn(|c| async move { c.load_pages(None).await }),
                Action::SelectPage(id) => ctl.spawn(|c| async move { c.select_page(id).await }),
                Action::SavePage => ctl.spawn(|c| c.save_page()),
                Action::SaveOffer => ctl.spawn(|c| c.save_offer()),
                Action::DeletePage => ctl.spawn(|c| c.delete_page()),
                Action::DeleteOffer => ctl.spawn(|c| c.delete_offer()),
                Action::Publish => ctl.spawn(|c| c.publish()),
            }
        }
    }

    fn busy(&self) -> bool {
        self.state.lock().unwrap().busy
    }

    fn session_changed(&mut self, shared: &Shared) {
        self.state.lock().unwrap().close(shared);
    }
}

fn header(ui: &mut egui::Ui, palette: &Palette, s: &mut State, shared: &Shared, actions: &mut Vec<Action>) {
    ui.horizontal(|ui| {
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if ui.add(widgets::secondary_button(t("Back"))).clicked() {
                shared.request(Request::Go(AppPage::Dashboard));
            }
            let ready = s.session.is_some() && !s.busy;
            let publish = if s.unpublished { t("Publish changes") } else { t("Publish") };
            if ui.add_enabled(ready, widgets::primary_button(publish)).on_hover_text(t("The emulator loads the catalogue again and tells the players online to refresh it.")).clicked() {
                actions.push(Action::Publish);
            }
            if ui.add_enabled(ready, small(t("Refresh"))).clicked() {
                actions.push(Action::Refresh);
            }
            if s.login_visible && ui.add(widgets::primary_button(t("Log in to MariaDB"))).clicked() {
                actions.push(Action::Login);
            }
            ui.with_layout(egui::Layout::top_down(egui::Align::Min), |ui| {
                ui.label(RichText::new(t("Catalogue")).size(13.0).strong());
                ui.add(egui::Label::new(RichText::new(&s.subtitle).size(12.0).color(palette.muted)).wrap());
            });
        });
    });
    if !s.status.text.is_empty() {
        ui.add_space(4.0);
        let color = if s.status.error { palette.error_text } else { palette.muted };
        ui.add(egui::Label::new(RichText::new(&s.status.text).size(12.0).color(color)).wrap());
    }
}

fn body(ui: &mut egui::Ui, palette: &Palette, s: &mut State, actions: &mut Vec<Action>) {
    egui::SidePanel::left("catalog-tree")
        .resizable(true)
        .default_width(300.0)
        .width_range(200.0..=600.0)
        .frame(frame(palette).outer_margin(egui::Margin { left: 0, right: 6, top: 0, bottom: 0 }))
        .show_inside(ui, |ui| tree(ui, palette, s, actions));
    egui::CentralPanel::default().frame(frame(palette)).show_inside(ui, |ui| {
        egui::ScrollArea::vertical().id_salt("catalog-editor").auto_shrink([false, false]).show(ui, |ui| editors(ui, palette, s, actions));
    });
}

fn tree(ui: &mut egui::Ui, palette: &Palette, s: &mut State, actions: &mut Vec<Action>) {
    ui.horizontal(|ui| {
        let ready = s.session.is_some() && !s.busy;
        if ui.add_enabled(ready, small(t("New page"))).on_hover_text(t("A new page under the page shown, or at the top level.")).clicked() {
            let parent = s.page.as_ref().filter(|p| p.id > 0).map_or(-1, |p| p.id);
            let draft = catalog_admin::new_page(&s.pages, parent);
            s.page = Some(draft.clone());
            s.page_edit = Some(draft);
            s.offers.clear();
            s.offer = None;
            s.offer_edit = None;
        }
    });
    ui.add_space(4.0);
    ui.add(egui::TextEdit::singleline(&mut s.search).hint_text(t("Search pages")).desired_width(f32::INFINITY));
    ui.add_space(6.0);
    let query = s.search.trim().to_lowercase();
    let selected = s.page.as_ref().map(|p| p.id);
    let mut select = None;
    egui::ScrollArea::both().id_salt("catalog-tree-scroll").auto_shrink([false, false]).show(ui, |ui| {
        for row in &s.rows {
            let page = &s.pages[row.index];
            let matches = query.is_empty() || page.caption.to_lowercase().contains(&query) || page.caption_save.to_lowercase().contains(&query) || page.id.to_string() == query;
            if !matches {
                continue;
            }
            let indent = if query.is_empty() { row.depth as f32 * 14.0 } else { 0.0 };
            let inner = ui.horizontal(|ui| {
                ui.add_space(indent);
                ui.spacing_mut().item_spacing.x = 6.0;
                icons::show(ui, if row.depth == 0 { Icon::Folder } else { Icon::File }, 13.0, Fixed::brand());
                let color = if page.visible && page.enabled { palette.text } else { palette.subtle };
                ui.add(egui::Label::new(RichText::new(&page.caption).size(12.5).color(color)).selectable(false));
                ui.add(egui::Label::new(RichText::new(format!("#{}", page.id)).size(10.5).color(palette.subtle)).selectable(false));
            });
            let rect = inner.response.rect.expand(2.0);
            let response = ui.interact(rect, ui.id().with(("catalog-page", page.id)), egui::Sense::click());
            if selected == Some(page.id) || response.hovered() {
                let color = if selected == Some(page.id) { palette.selected } else { palette.hover };
                ui.painter().rect_filled(rect, 4.0, crate::gui::theme::with_alpha(color, 0x90));
            }
            if response.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() {
                select = Some(page.id);
            }
        }
    });
    if let Some(id) = select {
        if selected != Some(id) {
            actions.push(Action::SelectPage(id));
        }
    }
}

fn labelled(ui: &mut egui::Ui, palette: &Palette, label: &str) {
    ui.label(RichText::new(label).size(12.0).color(palette.muted));
}

fn number(ui: &mut egui::Ui, value: &mut i64, range: std::ops::RangeInclusive<i64>) {
    ui.add(egui::DragValue::new(value).range(range).speed(1));
}

fn editors(ui: &mut egui::Ui, palette: &Palette, s: &mut State, actions: &mut Vec<Action>) {
    if s.page_edit.is_none() {
        ui.add_space(20.0);
        widgets::muted(ui, palette, t("Choose a page on the left."), 13.0);
        return;
    }
    let pages = s.pages.clone();
    let busy = s.busy;
    let is_new_page = s.page_edit.as_ref().is_some_and(|p| p.id <= 0);
    let page_changed = s.page_edit != s.page || is_new_page;
    let page_problem = s.page_edit.as_ref().and_then(|p| catalog_admin::page_problem(p, &pages));

    ui.label(widgets::title_text(if is_new_page { t("New page") } else { t("Page") }, 17.0));
    ui.add_space(4.0);
    if let Some(page) = s.page_edit.as_mut() {
        egui::Grid::new("catalog-page-form").num_columns(4).spacing([12.0, 6.0]).show(ui, |ui| {
            labelled(ui, palette, t("Name"));
            ui.add(egui::TextEdit::singleline(&mut page.caption).desired_width(220.0));
            labelled(ui, palette, t("Internal name"));
            ui.add(egui::TextEdit::singleline(&mut page.caption_save).desired_width(160.0));
            ui.end_row();

            labelled(ui, palette, t("Layout"));
            egui::ComboBox::from_id_salt("catalog-layout").selected_text(&page.layout).width(220.0).show_ui(ui, |ui| {
                for layout in LAYOUTS {
                    ui.selectable_value(&mut page.layout, layout.to_string(), *layout);
                }
            });
            labelled(ui, palette, t("Catalogue"));
            egui::ComboBox::from_id_salt("catalog-mode").selected_text(&page.catalog_mode).show_ui(ui, |ui| {
                for mode in CATALOG_MODES {
                    ui.selectable_value(&mut page.catalog_mode, mode.to_string(), *mode);
                }
            });
            ui.end_row();

            labelled(ui, palette, t("Parent page"));
            let parent_name = pages.iter().find(|p| p.id == page.parent_id).map(|p| format!("{} #{}", p.caption, p.id)).unwrap_or_else(|| t("(top level)").to_string());
            egui::ComboBox::from_id_salt("catalog-parent").selected_text(parent_name).width(220.0).show_ui(ui, |ui| {
                ui.selectable_value(&mut page.parent_id, -1, t("(top level)"));
                for other in pages.iter().filter(|p| p.id != page.id && !catalog_admin::is_ancestor(&pages, page.id, p.id)) {
                    ui.selectable_value(&mut page.parent_id, other.id, format!("{} #{}", other.caption, other.id));
                }
            });
            labelled(ui, palette, t("Order"));
            number(ui, &mut page.order_num, -1000..=100_000);
            ui.end_row();

            labelled(ui, palette, t("Icon"));
            number(ui, &mut page.icon_image, 0..=100_000);
            labelled(ui, palette, t("Minimum rank"));
            number(ui, &mut page.min_rank, 0..=100);
            ui.end_row();

            labelled(ui, palette, t("Shown"));
            ui.horizontal(|ui| {
                ui.checkbox(&mut page.visible, t("Visible"));
                ui.checkbox(&mut page.enabled, t("Enabled"));
                ui.checkbox(&mut page.club_only, t("Club only"));
            });
            ui.end_row();
        });
    }
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        if ui.add_enabled(page_changed && page_problem.is_none() && !busy, widgets::primary_button(t("Save page"))).clicked() {
            actions.push(Action::SavePage);
        }
        if ui.add_enabled(page_changed && !busy, small(t("Undo changes"))).clicked() {
            if is_new_page {
                s.page = None;
                s.page_edit = None;
            } else {
                s.page_edit = s.page.clone();
            }
        }
        if !is_new_page && ui.add_enabled(!busy, small(t("Delete page"))).clicked() {
            actions.push(Action::DeletePage);
        }
        if let Some(problem) = &page_problem {
            ui.label(RichText::new(problem).size(12.0).color(palette.error_text));
        } else if page_changed {
            ui.label(RichText::new(t("Not saved yet.")).size(12.0).color(palette.muted));
        }
    });

    if is_new_page || s.page_edit.is_none() {
        return;
    }
    ui.add_space(14.0);
    ui.horizontal(|ui| {
        ui.label(widgets::title_text(&tf("Offers ({count})", &[("count", &s.offers.len().to_string())]), 17.0));
        if ui.add_enabled(!busy, small(t("New offer"))).clicked() {
            if let Some(page) = s.page.as_ref() {
                let draft = catalog_admin::new_offer(&s.offers, page.id);
                s.offer = Some(draft.clone());
                s.offer_edit = Some(draft);
            }
        }
    });
    ui.add_space(4.0);
    offers_table(ui, palette, s);

    if s.offer_edit.is_some() {
        ui.add_space(14.0);
        offer_form(ui, palette, s, actions);
    }
}

fn offers_table(ui: &mut egui::Ui, palette: &Palette, s: &mut State) {
    if s.offers.is_empty() {
        widgets::muted(ui, palette, t("No offers on this page."), 12.5);
        return;
    }
    let selected = s.offer.as_ref().map(|o| o.id);
    let mut select = None;
    egui::Grid::new("catalog-offers").striped(true).num_columns(6).spacing([14.0, 4.0]).show(ui, |ui| {
        for heading in [t("Name"), t("Furni"), t("Credits"), t("Points"), t("Limited"), t("Order")] {
            ui.label(RichText::new(heading).size(11.5).color(palette.muted).strong());
        }
        ui.end_row();
        for offer in &s.offers {
            let name = if selected == Some(offer.id) { RichText::new(&offer.catalog_name).strong() } else { RichText::new(&offer.catalog_name) };
            if ui.add(egui::Label::new(name.size(12.5)).sense(egui::Sense::click())).on_hover_cursor(egui::CursorIcon::PointingHand).clicked() {
                select = Some(offer.id);
            }
            ui.label(RichText::new(&offer.item_ids).size(12.0));
            ui.label(RichText::new(offer.cost_credits.to_string()).size(12.0));
            ui.label(RichText::new(if offer.cost_points > 0 { format!("{} ({})", offer.cost_points, offer.points_type) } else { "0".into() }).size(12.0));
            ui.label(RichText::new(if offer.limited_stack > 0 { format!("{} / {}", offer.limited_sells, offer.limited_stack) } else { "-".into() }).size(12.0));
            ui.label(RichText::new(offer.order_number.to_string()).size(12.0));
            ui.end_row();
        }
    });
    if let Some(id) = select {
        if let Some(offer) = s.offers.iter().find(|o| o.id == id).cloned() {
            s.offer = Some(offer.clone());
            s.offer_edit = Some(offer);
        }
    }
}

fn offer_form(ui: &mut egui::Ui, palette: &Palette, s: &mut State, actions: &mut Vec<Action>) {
    let busy = s.busy;
    let is_new = s.offer_edit.as_ref().is_some_and(|o| o.id <= 0);
    let changed = s.offer_edit != s.offer || is_new;
    let problem = s.offer_edit.as_ref().and_then(catalog_admin::offer_problem);
    let pages = s.pages.clone();
    let Some(offer) = s.offer_edit.as_mut() else { return };

    let title = if is_new { t("New offer").to_string() } else { tf("Offer #{id}", &[("id", &offer.id.to_string())]) };
    ui.label(widgets::title_text(&title, 15.0));
    ui.add_space(4.0);
    egui::Grid::new("catalog-offer-form").num_columns(4).spacing([12.0, 6.0]).show(ui, |ui| {
        labelled(ui, palette, t("Name"));
        ui.add(egui::TextEdit::singleline(&mut offer.catalog_name).desired_width(220.0));
        labelled(ui, palette, t("Furni ids"));
        ui.add(egui::TextEdit::singleline(&mut offer.item_ids).desired_width(160.0)).on_hover_text(t("items_base ids: one id, or several as a bundle (100;200)."));
        ui.end_row();

        labelled(ui, palette, t("Credits"));
        number(ui, &mut offer.cost_credits, 0..=1_000_000_000);
        labelled(ui, palette, t("Points"));
        ui.horizontal(|ui| {
            number(ui, &mut offer.cost_points, 0..=1_000_000_000);
            ui.label(RichText::new(t("type")).size(12.0).color(palette.muted));
            number(ui, &mut offer.points_type, 0..=1000);
        });
        ui.end_row();

        labelled(ui, palette, t("Amount"));
        number(ui, &mut offer.amount, 1..=100_000);
        labelled(ui, palette, t("Limited size"));
        ui.horizontal(|ui| {
            number(ui, &mut offer.limited_stack, 0..=1_000_000);
            if offer.limited_stack > 0 {
                ui.label(RichText::new(tf("{sold} sold", &[("sold", &offer.limited_sells.to_string())])).size(12.0).color(palette.muted));
            }
        });
        ui.end_row();

        labelled(ui, palette, t("Order"));
        number(ui, &mut offer.order_number, -1000..=1_000_000);
        labelled(ui, palette, t("Offer id"));
        number(ui, &mut offer.offer_id, -1..=i32::MAX as i64);
        ui.end_row();

        labelled(ui, palette, t("Page"));
        let page_name = pages.iter().find(|p| p.id == offer.page_id).map(|p| format!("{} #{}", p.caption, p.id)).unwrap_or_else(|| format!("#{}", offer.page_id));
        egui::ComboBox::from_id_salt("catalog-offer-page").selected_text(page_name).width(220.0).show_ui(ui, |ui| {
            for page in &pages {
                ui.selectable_value(&mut offer.page_id, page.id, format!("{} #{}", page.caption, page.id));
            }
        });
        labelled(ui, palette, t("Extra data"));
        ui.add(egui::TextEdit::singleline(&mut offer.extradata).desired_width(160.0));
        ui.end_row();

        labelled(ui, palette, t("Options"));
        ui.horizontal(|ui| {
            ui.checkbox(&mut offer.club_only, t("Club only"));
            ui.checkbox(&mut offer.have_offer, t("Can be bought in bulk"));
        });
        ui.end_row();
    });
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        if ui.add_enabled(changed && problem.is_none() && !busy, widgets::primary_button(t("Save offer"))).clicked() {
            actions.push(Action::SaveOffer);
        }
        if ui.add_enabled(changed && !busy, small(t("Undo changes"))).clicked() {
            if is_new {
                s.offer = None;
                s.offer_edit = None;
            } else {
                s.offer_edit = s.offer.clone();
            }
        }
        if !is_new && ui.add_enabled(!busy, small(t("Delete offer"))).clicked() {
            actions.push(Action::DeleteOffer);
        }
        if let Some(problem) = &problem {
            ui.label(RichText::new(problem).size(12.0).color(palette.error_text));
        } else if changed {
            ui.label(RichText::new(t("Not saved yet.")).size(12.0).color(palette.muted));
        }
    });
}

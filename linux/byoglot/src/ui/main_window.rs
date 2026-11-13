use crate::{
    i18n::{Msg, tr},
    services::Services,
    ui::{connections_page, preferences, templates_page, translate_page},
};
use adw::prelude::*;
use gtk::gio;
use std::sync::Arc;

pub fn build(app: &adw::Application, services: Arc<Services>) -> adw::ApplicationWindow {
    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("ByoGlot")
        .default_width(850)
        .default_height(780)
        .build();
    let toolbar = adw::ToolbarView::new();
    let stack = adw::ViewStack::new();
    let header = adw::HeaderBar::new();
    let switcher = adw::ViewSwitcher::builder()
        .stack(&stack)
        .policy(adw::ViewSwitcherPolicy::Wide)
        .build();
    header.set_title_widget(Some(&switcher));
    let menu = gio::Menu::new();
    for (message, action) in [
        (Msg::Preferences, "win.preferences"),
        (Msg::KeyboardShortcuts, "win.shortcuts"),
        (Msg::About, "win.about"),
        (Msg::Quit, "app.quit"),
    ] {
        menu.append(Some(tr(message)), Some(action));
    }
    let button = gtk::MenuButton::builder()
        .icon_name("open-menu-symbolic")
        .menu_model(&menu)
        .tooltip_text(tr(Msg::Menu))
        .build();
    header.pack_end(&button);
    toolbar.add_top_bar(&header);
    let translate = translate_page::build(services.clone(), &stack);
    let connections = connections_page::build(services.clone(), &window);
    let templates = templates_page::build(services.clone(), &window);
    stack.add_titled_with_icon(
        &translate,
        Some("translate"),
        tr(Msg::Translate),
        "accessories-dictionary-symbolic",
    );
    stack.add_titled_with_icon(
        &templates,
        Some("templates"),
        tr(Msg::Templates),
        "view-list-symbolic",
    );
    stack.add_titled_with_icon(
        &connections,
        Some("connections"),
        tr(Msg::Connections),
        "network-server-symbolic",
    );
    let switcher_bar = adw::ViewSwitcherBar::builder()
        .stack(&stack)
        .reveal(true)
        .build();
    toolbar.add_bottom_bar(&switcher_bar);
    toolbar.set_content(Some(&stack));
    if !services.secrets.is_persistent() {
        toolbar.add_top_bar(
            &adw::Banner::builder()
                .title(tr(Msg::NoKeyring))
                .revealed(true)
                .build(),
        );
    }
    window.set_content(Some(&toolbar));
    let action = gio::SimpleAction::new("preferences", None);
    let weak = window.downgrade();
    action.connect_activate(move |_, _| {
        if let Some(window) = weak.upgrade() {
            preferences::present(&window, services.clone());
        }
    });
    window.add_action(&action);
    let action = gio::SimpleAction::new("shortcuts", None);
    let weak = window.downgrade();
    action.connect_activate(move |_, _| {
        if let Some(window) = weak.upgrade() {
            let dialog = adw::AlertDialog::builder()
                .heading(tr(Msg::KeyboardShortcuts))
                .body(format!(
                    "{}\n\n{}",
                    tr(Msg::WindowShortcuts),
                    tr(Msg::ShortcutLater)
                ))
                .build();
            dialog.add_response("close", tr(Msg::Close));
            dialog.present(Some(&window));
        }
    });
    window.add_action(&action);
    let action = gio::SimpleAction::new("about", None);
    let weak = window.downgrade();
    action.connect_activate(move |_, _| {
        if let Some(window) = weak.upgrade() {
            adw::AboutDialog::builder()
                .application_name("ByoGlot")
                .application_icon(crate::APP_ID)
                .developer_name("BrainRTP")
                .version(env!("CARGO_PKG_VERSION"))
                .license_type(gtk::License::MitX11)
                .website("https://github.com/BrainRTP/byoglot-translator")
                .comments(tr(Msg::AboutDescription))
                .build()
                .present(Some(&window));
        }
    });
    window.add_action(&action);
    window
}

pub fn combo(title: &str, values: &[String], selected: usize) -> adw::ComboRow {
    let values: Vec<_> = values.iter().map(String::as_str).collect();
    adw::ComboRow::builder()
        .title(title)
        .use_markup(false)
        .model(&gtk::StringList::new(&values))
        .selected(selected as u32)
        .build()
}

pub fn banner() -> adw::Banner {
    adw::Banner::builder().title("").revealed(false).build()
}
pub fn show_error(banner: &adw::Banner, error: &byoglot_core::RunnerError) {
    banner.set_title(&super::error_text::error_text(error));
    banner.set_revealed(true);
}
pub fn page_box() -> gtk::Box {
    gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_top(18)
        .margin_bottom(18)
        .margin_start(18)
        .margin_end(18)
        .build()
}
pub fn scroll(child: &impl IsA<gtk::Widget>) -> gtk::ScrolledWindow {
    gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .child(child)
        .vexpand(true)
        .build()
}

pub fn form_dialog(title: &str) -> (adw::Dialog, gtk::Box) {
    let dialog = adw::Dialog::builder()
        .title(title)
        .content_width(580)
        .content_height(640)
        .build();
    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    let content = page_box();
    toolbar.set_content(Some(&scroll(&content)));
    dialog.set_child(Some(&toolbar));
    (dialog, content)
}

pub async fn confirm_delete(window: &adw::ApplicationWindow, heading: Msg) -> bool {
    let dialog = adw::AlertDialog::builder()
        .heading(tr(heading))
        .body(tr(Msg::DeleteExplanation))
        .build();
    dialog.add_response("cancel", tr(Msg::Cancel));
    dialog.add_response("delete", tr(Msg::Delete));
    dialog.set_response_appearance("delete", adw::ResponseAppearance::Destructive);
    dialog.set_default_response(Some("cancel"));
    dialog.set_close_response("cancel");
    dialog.choose_future(Some(window)).await == "delete"
}

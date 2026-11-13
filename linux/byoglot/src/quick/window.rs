use crate::{
    i18n::{Msg, tr, tr_with},
    quick::controller::gui::Driver,
    ui::error_text::error_text,
};
use adw::prelude::*;
use byoglot_core::{QuickEvent, QuickState, Template};
use gtk::{gdk, gio, glib};
use std::{rc::Rc, time::Duration};

pub struct QuickWindow {
    pub window: adw::Window,
    hint: gtk::Label,
    entry: gtk::Entry,
    paste: gtk::Button,
    source: gtk::Label,
    spinner: gtk::Spinner,
    result: gtk::Label,
    copy: gtk::Button,
    templates: gtk::MenuButton,
    open: gtk::Button,
}
impl QuickWindow {
    pub fn new(app: &adw::Application) -> Self {
        let window = adw::Window::builder()
            .application(app)
            .title("ByoGlot")
            .default_width(420)
            .default_height(300)
            .hide_on_close(true)
            .build();
        let toolbar = adw::ToolbarView::new();
        toolbar.add_top_bar(&adw::HeaderBar::new());
        let content = crate::ui::main_window::page_box();
        let hint = gtk::Label::builder()
            .label(tr(Msg::QuickHint))
            .wrap(true)
            .xalign(0.0)
            .build();
        let entry = gtk::Entry::builder()
            .placeholder_text(tr(Msg::Input))
            .build();
        let paste = gtk::Button::with_label(tr(Msg::Paste));
        let source = gtk::Label::builder()
            .wrap(true)
            .lines(2)
            .ellipsize(gtk::pango::EllipsizeMode::End)
            .xalign(0.0)
            .selectable(true)
            .build();
        let spinner = gtk::Spinner::new();
        let result = gtk::Label::builder()
            .wrap(true)
            .selectable(true)
            .xalign(0.0)
            .yalign(0.0)
            .build();
        let copy = gtk::Button::with_label(tr(Msg::Copy));
        let templates = gtk::MenuButton::builder().label(tr(Msg::Template)).build();
        let open = gtk::Button::with_label(tr(Msg::OpenMain));
        for widget in [
            hint.upcast_ref::<gtk::Widget>(),
            entry.upcast_ref(),
            paste.upcast_ref(),
            source.upcast_ref(),
            spinner.upcast_ref(),
            result.upcast_ref(),
            copy.upcast_ref(),
            templates.upcast_ref(),
            open.upcast_ref(),
        ] {
            content.append(widget);
        }
        toolbar.set_content(Some(&crate::ui::main_window::scroll(&content)));
        window.set_content(Some(&toolbar));
        Self {
            window,
            hint,
            entry,
            paste,
            source,
            spinner,
            result,
            copy,
            templates,
            open,
        }
    }
    pub fn connect(&self, driver: &Rc<Driver>, app: &adw::Application) {
        let weak = Rc::downgrade(driver);
        self.window.connect_is_active_notify(move |window| {
            if window.is_active()
                && let Some(driver) = weak.upgrade()
            {
                driver.dispatch(QuickEvent::Focused);
            }
        });
        let weak = Rc::downgrade(driver);
        self.window.connect_close_request(move |_| {
            if let Some(driver) = weak.upgrade() {
                driver.dispatch(QuickEvent::Dismissed);
            }
            glib::Propagation::Stop
        });
        let keys = gtk::EventControllerKey::new();
        let weak = Rc::downgrade(driver);
        keys.connect_key_pressed(move |_, key, _, _| {
            if key == gdk::Key::Escape {
                if let Some(driver) = weak.upgrade() {
                    driver.dispatch(QuickEvent::Dismissed);
                }
                glib::Propagation::Stop
            } else {
                glib::Propagation::Proceed
            }
        });
        self.window.add_controller(keys);
        let weak = Rc::downgrade(driver);
        self.entry.connect_activate(move |entry| {
            if let Some(driver) = weak.upgrade() {
                driver.dispatch(QuickEvent::Pasted(entry.text().to_string()));
            }
        });
        let weak = Rc::downgrade(driver);
        self.paste.connect_clicked(move |button| {
            let weak = weak.clone();
            let clipboard = button.clipboard();
            glib::spawn_future_local(async move {
                let text = glib::future_with_timeout(
                    Duration::from_millis(300),
                    clipboard.read_text_future(),
                )
                .await
                .ok()
                .and_then(Result::ok)
                .flatten();
                if let Some(driver) = weak.upgrade() {
                    driver.dispatch(QuickEvent::Pasted(
                        text.map(|s| s.to_string()).unwrap_or_default(),
                    ));
                }
            });
        });
        let label = self.result.downgrade();
        self.copy.connect_clicked(move |button| {
            if let Some(label) = label.upgrade() {
                button.clipboard().set_text(&label.text());
            }
        });
        let weak = Rc::downgrade(driver);
        let app = app.downgrade();
        self.open.connect_clicked(move |_| {
            if let (Some(driver), Some(app)) = (weak.upgrade(), app.upgrade()) {
                if let Some(source) = driver.source() {
                    app.activate_action("open-text", Some(&source.to_variant()));
                }
                driver.dispatch(QuickEvent::Dismissed);
            }
        });
        let group = gio::SimpleActionGroup::new();
        let action = gio::SimpleAction::new("template", Some(glib::VariantTy::STRING));
        let weak = Rc::downgrade(driver);
        action.connect_activate(move |_, value| {
            if let (Some(driver), Some(id)) = (weak.upgrade(), value.and_then(|v| v.str())) {
                driver.choose_template(id.into());
            }
        });
        group.add_action(&action);
        self.window.insert_action_group("quick", Some(&group));
    }
    pub fn set_templates(&self, templates: &[Template], default: &str) {
        let menu = gio::Menu::new();
        for template in templates {
            let item = gio::MenuItem::new(Some(&template.name), None);
            item.set_action_and_target_value(
                Some("quick.template"),
                Some(&template.id.to_variant()),
            );
            menu.append_item(&item);
        }
        self.templates.set_menu_model(Some(&menu));
        if let Some(template) = templates.iter().find(|t| t.id == default) {
            self.templates.set_tooltip_text(Some(&template.name));
        }
    }
    pub fn render(&self, state: &QuickState) {
        let needs_text = matches!(
            state,
            QuickState::WaitingForFocus | QuickState::NeedsText | QuickState::TooLong { .. }
        );
        let done = matches!(state, QuickState::Done { .. });
        self.hint.set_visible(needs_text);
        self.entry.set_visible(needs_text);
        self.paste.set_visible(needs_text);
        self.spinner
            .set_visible(matches!(state, QuickState::Translating { .. }));
        self.spinner
            .set_spinning(matches!(state, QuickState::Translating { .. }));
        self.source
            .set_visible(matches!(state, QuickState::Translating { .. }));
        self.result
            .set_visible(done || matches!(state, QuickState::Failed { .. }));
        self.copy.set_visible(done);
        self.templates.set_visible(done);
        self.open
            .set_visible(done || matches!(state, QuickState::Failed { .. }));
        match state {
            QuickState::Hidden => {
                self.window.set_visible(false);
                self.entry.set_text("");
                self.source.set_text("");
                self.result.set_text("");
            }
            QuickState::WaitingForFocus | QuickState::NeedsText => {
                self.hint.set_text(tr(Msg::QuickHint));
                self.entry.grab_focus();
            }
            QuickState::TooLong { limit } => {
                self.hint
                    .set_text(&tr_with(Msg::ErrTooLong, &limit.to_string()));
                self.entry.grab_focus();
            }
            QuickState::Translating { source } => self.source.set_text(source),
            QuickState::Done { output, .. } => self.result.set_text(&output.text),
            QuickState::Failed { error, .. } => self.result.set_text(&error_text(error)),
        }
    }
}

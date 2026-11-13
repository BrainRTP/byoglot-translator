use crate::{
    i18n::{Msg, language_name, tr},
    services::Services,
    ui::main_window::{banner, combo, form_dialog, show_error},
    view_state::{new_id, save_template},
};
use adw::prelude::*;
use byoglot_core::{Template, TemplateSettings, contracts};
use gtk::glib;
use std::{rc::Rc, sync::Arc};

pub fn present(
    window: &adw::ApplicationWindow,
    services: Arc<Services>,
    existing: Option<Template>,
    changed: impl Fn() + 'static,
) {
    let template = existing.unwrap_or_else(|| Template {
        id: new_id("template"),
        name: String::new(),
        builtin: false,
        settings: TemplateSettings::default(),
    });
    if template.builtin {
        return;
    }
    let (dialog, content) = form_dialog(tr(Msg::EditTemplate));
    let error = banner();
    content.append(&error);
    let group = adw::PreferencesGroup::new();
    let name = adw::EntryRow::builder()
        .title(tr(Msg::Name))
        .text(&template.name)
        .build();
    group.add(&name);
    let mut languages = vec![tr(Msg::UseDefault).into()];
    languages.extend(contracts::language_codes().iter().map(|s| language_name(s)));
    let selected = template
        .settings
        .target_lang
        .as_ref()
        .and_then(|s| contracts::language_codes().iter().position(|c| c == s))
        .map_or(0, |i| i + 1);
    let target = combo(tr(Msg::TargetLanguage), &languages, selected);
    group.add(&target);
    content.append(&group);
    content.append(
        &gtk::Label::builder()
            .label(tr(Msg::Instructions))
            .xalign(0.0)
            .build(),
    );
    let instructions = gtk::TextView::builder()
        .wrap_mode(gtk::WrapMode::WordChar)
        .height_request(240)
        .build();
    instructions
        .buffer()
        .set_text(template.settings.pre_prompt.as_deref().unwrap_or_default());
    content.append(&super::main_window::scroll(&instructions));
    let save = gtk::Button::with_label(tr(Msg::Save));
    save.add_css_class("suggested-action");
    content.append(&save);
    let weak = dialog.downgrade();
    let changed = Rc::new(changed);
    save.connect_clicked(move |button| {
        if name.text().trim().is_empty() {
            error.set_title(tr(Msg::NameRequired));
            error.set_revealed(true);
            return;
        }
        let mut template = template.clone();
        template.name = name.text().trim().into();
        let buffer = instructions.buffer();
        template.settings.pre_prompt = Some(
            buffer
                .text(&buffer.start_iter(), &buffer.end_iter(), false)
                .into(),
        );
        template.settings.target_lang = target
            .selected()
            .checked_sub(1)
            .and_then(|i| contracts::language_codes().get(i as usize).cloned());
        let service = services.clone();
        let error = error.clone();
        let dialog = weak.clone();
        let button = button.clone();
        let changed = changed.clone();
        button.set_sensitive(false);
        glib::spawn_future_local(async move {
            match service
                .change(move |mut s| {
                    save_template(&mut s, template);
                    s
                })
                .await
            {
                Ok(_) => {
                    changed();
                    if let Some(dialog) = dialog.upgrade() {
                        dialog.close();
                    }
                }
                Err(problem) => {
                    show_error(&error, &problem);
                    button.set_sensitive(true);
                }
            }
        });
    });
    dialog.present(Some(window));
}

use crate::{
    i18n::{Msg, tr, tr_with},
    services::Services,
    ui::main_window::{banner, combo, form_dialog, show_error},
    view_state::{model_choices, remote_origin},
};
use adw::prelude::*;
use byoglot_core::{Connection, ConnectionDraft, ProviderPreset, SettingsRepository, contracts};
use gtk::glib;
use std::{cell::RefCell, rc::Rc, sync::Arc};

const PRESETS: [ProviderPreset; 7] = [
    ProviderPreset::Deepseek,
    ProviderPreset::Openrouter,
    ProviderPreset::Openai,
    ProviderPreset::Mistral,
    ProviderPreset::Ollama,
    ProviderPreset::Lmstudio,
    ProviderPreset::Custom,
];

pub fn present(
    window: &adw::ApplicationWindow,
    services: Arc<Services>,
    existing: Option<Connection>,
    changed: impl Fn() + 'static,
) {
    let (dialog, content) = form_dialog(tr(if existing.is_some() {
        Msg::EditConnection
    } else {
        Msg::AddConnection
    }));
    let error = banner();
    content.append(&error);
    if !services.secrets.is_persistent() {
        let warning = adw::Banner::builder()
            .title(tr(Msg::NoKeyring))
            .revealed(true)
            .build();
        content.append(&warning);
    }
    let form = adw::PreferencesGroup::new();
    let initial = existing
        .as_ref()
        .map_or(ProviderPreset::Deepseek, |c| c.preset);
    let preset = combo(
        tr(Msg::Preset),
        &[
            "DeepSeek".into(),
            "OpenRouter".into(),
            "OpenAI".into(),
            "Mistral".into(),
            "Ollama".into(),
            "LM Studio".into(),
            tr(Msg::Custom).into(),
        ],
        PRESETS.iter().position(|p| *p == initial).unwrap_or(0),
    );
    let name = adw::EntryRow::builder()
        .title(tr(Msg::Name))
        .text(existing.as_ref().map_or("DeepSeek", |c| c.name.as_str()))
        .build();
    let url = adw::EntryRow::builder()
        .title(tr(Msg::BaseUrl))
        .text(
            existing
                .as_ref()
                .map_or(contracts::presets()[&initial].base_url.as_str(), |c| {
                    c.base_url.as_str()
                }),
        )
        .build();
    let key = adw::PasswordEntryRow::builder()
        .title(tr(Msg::ApiKey))
        .build();
    key.set_enable_emoji_completion(false);
    if existing.is_some() {
        key.set_title(tr(Msg::ApiKeyKeep));
    }
    let consent = adw::SwitchRow::builder().use_markup(false).build();
    form.add(&preset);
    form.add(&name);
    form.add(&url);
    form.add(&key);
    form.add(&consent);
    content.append(&form);
    let weak_url = url.downgrade();
    let weak_name = name.downgrade();
    preset.connect_selected_notify(move |row| {
        if let Some(preset) = PRESETS.get(row.selected() as usize) {
            if let Some(url) = weak_url.upgrade() {
                url.set_text(&contracts::presets()[preset].base_url);
            }
            if let Some(name) = weak_name.upgrade() {
                name.set_text(match preset {
                    ProviderPreset::Deepseek => "DeepSeek",
                    ProviderPreset::Openrouter => "OpenRouter",
                    ProviderPreset::Openai => "OpenAI",
                    ProviderPreset::Mistral => "Mistral",
                    ProviderPreset::Ollama => "Ollama",
                    ProviderPreset::Lmstudio => "LM Studio",
                    ProviderPreset::Custom => tr(Msg::Custom),
                });
            }
        }
    });
    let consented = Rc::new(RefCell::new(Vec::<String>::new()));
    let consent_update = consent.clone();
    let consented_update = consented.clone();
    url.connect_changed(move |url| {
        update_consent(&consent_update, &url.text(), &consented_update.borrow())
    });
    update_consent(&consent, &url.text(), &[]);
    let service = services.clone();
    let consented_initial = consented.clone();
    let weak_url = url.downgrade();
    let weak_consent = consent.downgrade();
    glib::spawn_future_local(async move {
        *consented_initial.borrow_mut() = service.settings.read().await.consented_origins;
        if let (Some(url), Some(consent)) = (weak_url.upgrade(), weak_consent.upgrade()) {
            update_consent(&consent, &url.text(), &consented_initial.borrow());
        }
    });
    let save = gtk::Button::with_label(tr(Msg::Save));
    save.add_css_class("suggested-action");
    content.append(&save);
    let models = gtk::Box::new(gtk::Orientation::Vertical, 12);
    content.append(&models);
    let current_id = Rc::new(RefCell::new(existing.as_ref().map(|c| c.id.clone())));
    let changed: Rc<dyn Fn()> = Rc::new(changed);
    if let Some(connection) = existing {
        load_models(&models, services.clone(), connection, &error);
    }
    let weak_dialog = dialog.downgrade();
    let form_save = form.clone();
    let changed_save = changed.clone();
    let application = window.application();
    let key_save = key.clone();
    save.connect_clicked(move |button| {
        let key = &key_save;
        if name.text().trim().is_empty() {
            error.set_title(tr(Msg::NameRequired));
            error.set_revealed(true);
            return;
        }
        if remote_origin(&url.text()).is_some() && !consent.is_active() {
            error.set_title(tr(Msg::ConsentRequired));
            error.set_revealed(true);
            return;
        }
        let draft = ConnectionDraft {
            id: current_id.borrow().clone(),
            preset: PRESETS[preset.selected() as usize],
            name: name.text().into(),
            base_url: url.text().into(),
            api_key: key.text().into(),
        };
        let consent = consent.is_active();
        let key = key.clone();
        let service = services.clone();
        let id = current_id.clone();
        let changed = changed_save.clone();
        let hold = application.as_ref().map(|app| app.hold());
        let error = error.clone();
        let form = form_save.clone();
        let models = models.clone();
        let button = button.clone();
        let dialog = weak_dialog.clone();
        button.set_sensitive(false);
        form.set_sensitive(false);
        models.set_sensitive(false);
        error.set_revealed(false);
        if let Some(dialog) = dialog.upgrade() {
            dialog.set_can_close(false);
        }
        glib::spawn_future_local(async move {
            let _hold = hold;
            match service.save_connection(draft, consent).await {
                Ok(connection) => {
                    key.set_text("");
                    *id.borrow_mut() = Some(connection.id.clone());
                    changed();
                    load_models(&models, service, connection, &error);
                }
                Err(problem) => show_error(&error, &problem),
            }
            button.set_sensitive(true);
            form.set_sensitive(true);
            models.set_sensitive(true);
            if let Some(dialog) = dialog.upgrade() {
                dialog.set_can_close(true);
            }
        });
    });
    let key_closed = key.clone();
    dialog.connect_closed(move |_| {
        key_closed.set_text("");
        changed();
    });
    dialog.present(Some(window));
}

fn update_consent(row: &adw::SwitchRow, url: &str, consented: &[String]) {
    let origin = remote_origin(url);
    row.set_visible(origin.is_some());
    row.set_title(&tr_with(
        Msg::Consent,
        origin.as_deref().unwrap_or_default(),
    ));
    row.set_active(origin.is_some_and(|origin| consented.contains(&origin)));
}

fn load_models(
    container: &gtk::Box,
    services: Arc<Services>,
    connection: Connection,
    error: &adw::Banner,
) {
    while let Some(child) = container.first_child() {
        container.remove(&child);
    }
    let group = adw::PreferencesGroup::builder()
        .title(tr(Msg::Models))
        .build();
    container.append(&group);
    let refresh = gtk::Button::with_label(tr(Msg::RefreshModels));
    container.append(&refresh);
    let weak_container = container.downgrade();
    let service = services.clone();
    let c = connection.clone();
    let error_refresh = error.clone();
    refresh.connect_clicked(move |_| {
        if let Some(container) = weak_container.upgrade() {
            load_models(&container, service.clone(), c.clone(), &error_refresh);
        }
    });
    let error = error.clone();
    glib::spawn_future_local(async move {
        let models = match services.models(connection.id.clone()).await {
            Ok(models) => models,
            Err(problem) => {
                show_error(&error, &problem);
                return;
            }
        };
        let settings = services.settings.read().await;
        let Some(connection) = settings
            .connections
            .into_iter()
            .find(|c| c.id == connection.id)
        else {
            return;
        };
        let choices = Rc::new(model_choices(&models, &connection.id));
        if choices.is_empty() {
            group.set_description(Some(tr(Msg::NoModels)));
            return;
        }
        let mut names = vec![tr(Msg::NotSelected).to_string()];
        names.extend(choices.iter().map(|m| match &m.variant {
            Some(variant) => format!("{} ({})", m.id, crate::i18n::effort_name(variant)),
            None => m.id.clone(),
        }));
        for (message, current, page) in [
            (Msg::PageModel, connection.page_model.as_ref(), true),
            (Msg::TextModel, connection.selection_model.as_ref(), false),
        ] {
            let selected = current
                .and_then(|m| choices.iter().position(|c| c == m))
                .map_or(0, |i| i + 1);
            let row = combo(tr(message), &names, selected);
            let service = services.clone();
            let choices = choices.clone();
            let id = connection.id.clone();
            let error = error.clone();
            row.connect_selected_notify(move |row| {
                let model = row
                    .selected()
                    .checked_sub(1)
                    .and_then(|i| choices.get(i as usize))
                    .cloned();
                let service = service.clone();
                let id = id.clone();
                let error = error.clone();
                glib::spawn_future_local(async move {
                    if let Err(problem) = service
                        .change(move |mut s| {
                            if let Some(c) = s.connections.iter_mut().find(|c| c.id == id) {
                                if page {
                                    c.page_model = model;
                                } else {
                                    c.selection_model = model;
                                }
                            }
                            s
                        })
                        .await
                    {
                        show_error(&error, &problem);
                    }
                });
            });
            group.add(&row);
        }
    });
}

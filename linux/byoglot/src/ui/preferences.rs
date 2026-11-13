use crate::{
    i18n::{Msg, language_name, tr, tr_with},
    services::Services,
    ui::main_window::{banner, combo, show_error},
    view_state::save_profile,
};
use adw::prelude::*;
use byoglot_core::{ExportFile, SettingsRepository, contracts, export_settings, merge_export};
use gtk::{gio, glib};
use std::{cell::Cell, rc::Rc, sync::Arc};

pub fn present(window: &adw::ApplicationWindow, services: Arc<Services>) {
    let window = window.clone();
    glib::spawn_future_local(async move {
        let settings = services.settings.read().await;
        let dialog = adw::PreferencesDialog::builder()
            .title(tr(Msg::Preferences))
            .search_enabled(false)
            .build();
        let page = adw::PreferencesPage::new();
        let messages = adw::PreferencesGroup::new();
        let error = banner();
        messages.add(&error);
        if !services.secrets.is_persistent() {
            messages.add(
                &adw::Banner::builder()
                    .title(tr(Msg::NoKeyring))
                    .revealed(true)
                    .build(),
            );
        }
        page.add(&messages);
        let style = adw::PreferencesGroup::builder()
            .title(tr(Msg::LanguageStyle))
            .build();
        let enabled = adw::SwitchRow::builder()
            .title(tr(Msg::LanguagePrompt))
            .active(settings.globals.language_prompt_enabled)
            .build();
        style.add(&enabled);
        let mut profiles = vec!["auto".to_string()];
        profiles.extend(contracts::builtin_profiles().keys().cloned());
        let names: Vec<_> = profiles
            .iter()
            .map(|p| {
                if p == "generic" {
                    tr(Msg::Generic).into()
                } else {
                    language_name(p)
                }
            })
            .collect();
        let selected = profiles
            .iter()
            .position(|p| *p == settings.globals.language_profile)
            .unwrap_or(0);
        let profile = combo(tr(Msg::LanguageProfile), &names, selected);
        style.add(&profile);
        let text = gtk::TextView::builder()
            .wrap_mode(gtk::WrapMode::WordChar)
            .height_request(180)
            .build();
        let profile_label = gtk::Label::builder()
            .label(tr(Msg::ProfileText))
            .xalign(0.0)
            .build();
        style.add(&profile_label);
        style.add(&super::main_window::scroll(&text));
        let buttons = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        let save = gtk::Button::with_label(tr(Msg::Save));
        let reset = gtk::Button::with_label(tr(Msg::ResetProfile));
        buttons.append(&save);
        buttons.append(&reset);
        style.add(&buttons);
        let profiles = Rc::new(profiles);
        update_profile(&text, &save, &reset, &profiles[selected], &settings);
        let service = services.clone();
        let error_enabled = error.clone();
        let loading = Rc::new(Cell::new(false));
        let updating = loading.clone();
        enabled.connect_active_notify(move |row| {
            if updating.get() {
                return;
            }
            let value = row.is_active();
            let row = row.clone();
            let service = service.clone();
            let error = error_enabled.clone();
            let updating = updating.clone();
            row.set_sensitive(false);
            glib::spawn_future_local(async move {
                if let Err(problem) = service
                    .change(move |mut s| {
                        s.globals.language_prompt_enabled = value;
                        s
                    })
                    .await
                {
                    updating.set(true);
                    row.set_active(!value);
                    updating.set(false);
                    show_error(&error, &problem);
                }
                row.set_sensitive(true);
            });
        });
        let service = services.clone();
        let ids = profiles.clone();
        let text_profile = text.clone();
        let save_profile_button = save.clone();
        let reset_profile = reset.clone();
        let error_profile = error.clone();
        let guard = loading.clone();
        profile.connect_selected_notify(move |row| {
            if guard.get() {
                return;
            }
            let Some(id) = ids.get(row.selected() as usize).cloned() else {
                return;
            };
            let service = service.clone();
            let error = error_profile.clone();
            let text = text_profile.clone();
            let save = save_profile_button.clone();
            let reset = reset_profile.clone();
            glib::spawn_future_local(async move {
                let profile_id = id.clone();
                match service
                    .change(move |mut s| {
                        s.globals.language_profile = profile_id;
                        s
                    })
                    .await
                {
                    Ok(settings) => update_profile(&text, &save, &reset, &id, &settings),
                    Err(problem) => show_error(&error, &problem),
                }
            });
        });
        for (button, reset_value) in [(save.clone(), false), (reset.clone(), true)] {
            let service = services.clone();
            let ids = profiles.clone();
            let profile = profile.clone();
            let text = text.clone();
            let error = error.clone();
            let save = save.clone();
            let reset = reset.clone();
            button.connect_clicked(move |_| {
                let Some(id) = ids.get(profile.selected() as usize).cloned() else {
                    return;
                };
                let buffer = text.buffer();
                let value = buffer
                    .text(&buffer.start_iter(), &buffer.end_iter(), false)
                    .to_string();
                if value.encode_utf16().count() > contracts::limits().max_profile_text
                    && !reset_value
                {
                    error.set_title(&tr_with(
                        Msg::ProfileLimit,
                        &contracts::limits().max_profile_text.to_string(),
                    ));
                    error.set_revealed(true);
                    return;
                }
                let service = service.clone();
                let error = error.clone();
                let text = text.clone();
                let save = save.clone();
                let reset = reset.clone();
                glib::spawn_future_local(async move {
                    let profile_id = id.clone();
                    match service
                        .change(move |mut s| {
                            save_profile(
                                &mut s,
                                &profile_id,
                                if reset_value { None } else { Some(value) },
                            );
                            s
                        })
                        .await
                    {
                        Ok(settings) => {
                            update_profile(&text, &save, &reset, &id, &settings);
                            error.set_revealed(false);
                        }
                        Err(problem) => show_error(&error, &problem),
                    }
                });
            });
        }
        page.add(&style);
        let shortcuts = adw::PreferencesGroup::builder()
            .title(tr(Msg::KeyboardShortcuts))
            .description(tr(Msg::ShortcutLater))
            .build();
        page.add(&shortcuts);
        let startup = adw::PreferencesGroup::builder()
            .title(tr(Msg::Startup))
            .build();
        let start = adw::SwitchRow::builder()
            .title(tr(Msg::StartBackground))
            .active(services.startup_enabled())
            .build();
        startup.add(&start);
        let changing = Rc::new(Cell::new(false));
        let service = services.clone();
        let error_start = error.clone();
        start.connect_active_notify(move |row| {
            if changing.get() {
                return;
            }
            let enabled = row.is_active();
            let row = row.clone();
            let service = service.clone();
            let error = error_start.clone();
            let changing = changing.clone();
            row.set_sensitive(false);
            glib::spawn_future_local(async move {
                let actual = match service.set_startup(enabled, tr(Msg::StartupReason)).await {
                    Ok(actual) => {
                        if actual != enabled {
                            error.set_title(tr(Msg::PortalUnavailable));
                            error.set_revealed(true);
                        }
                        actual
                    }
                    Err(_) => {
                        error.set_title(tr(Msg::PortalUnavailable));
                        error.set_revealed(true);
                        !enabled
                    }
                };
                changing.set(true);
                row.set_active(actual);
                changing.set(false);
                row.set_sensitive(true);
            });
        });
        page.add(&startup);
        let portable = adw::PreferencesGroup::builder()
            .title(tr(Msg::PortableSettings))
            .description(tr(Msg::ExportHint))
            .build();
        for export in [true, false] {
            let button = gtk::Button::builder()
                .label(tr(if export { Msg::Export } else { Msg::Import }))
                .halign(gtk::Align::Start)
                .build();
            portable.add(&button);
            let weak_window = window.downgrade();
            let service = services.clone();
            let error = error.clone();
            let weak_dialog = dialog.downgrade();
            button.connect_clicked(move |_| {
                if let Some(window) = weak_window.upgrade() {
                    let service = service.clone();
                    let error = error.clone();
                    let dialog = weak_dialog.clone();
                    glib::spawn_future_local(async move {
                        match transfer(&window, service, export).await {
                            Ok(true) => {
                                if let Some(dialog) = dialog.upgrade() {
                                    dialog.add_toast(adw::Toast::new(tr(if export {
                                        Msg::Exported
                                    } else {
                                        Msg::Imported
                                    })));
                                    if !export {
                                        dialog.close();
                                    }
                                }
                            }
                            Ok(false) => (),
                            Err(message) => {
                                error.set_title(tr(message));
                                error.set_revealed(true);
                            }
                        }
                    });
                }
            });
        }
        page.add(&portable);
        dialog.add(&page);
        dialog.present(Some(&window));
    });
}

fn update_profile(
    text: &gtk::TextView,
    save: &gtk::Button,
    reset: &gtk::Button,
    id: &str,
    settings: &byoglot_core::AppSettings,
) {
    let value = settings
        .profile_overrides
        .get(id)
        .map(|p| p.text.as_str())
        .or_else(|| contracts::builtin_profiles().get(id).map(String::as_str))
        .unwrap_or_default();
    text.buffer().set_text(value);
    let editable = contracts::builtin_profiles().contains_key(id);
    text.set_sensitive(editable);
    save.set_sensitive(editable);
    reset.set_sensitive(editable);
}

async fn transfer(
    window: &adw::ApplicationWindow,
    services: Arc<Services>,
    export: bool,
) -> Result<bool, Msg> {
    let picker = gtk::FileDialog::builder()
        .title(tr(if export { Msg::Export } else { Msg::Import }))
        .modal(true)
        .build();
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("JSON"));
    filter.add_pattern("*.json");
    let filters = gio::ListStore::new::<gtk::FileFilter>();
    filters.append(&filter);
    picker.set_filters(Some(&filters));
    picker.set_default_filter(Some(&filter));
    let selected = if export {
        picker.set_initial_name(Some("byoglot-settings.json"));
        picker.save_future(Some(window)).await
    } else {
        picker.open_future(Some(window)).await
    };
    let file = match selected {
        Ok(file) => file,
        Err(error)
            if error.matches(gtk::DialogError::Dismissed)
                || error.matches(gtk::DialogError::Cancelled) =>
        {
            return Ok(false);
        }
        Err(_) => return Err(Msg::FileError),
    };
    if export {
        let settings = services.settings.read().await;
        let now = glib::DateTime::now_utc()
            .map_err(|_| Msg::FileError)?
            .format_iso8601()
            .map_err(|_| Msg::FileError)?;
        let bytes = serde_json::to_vec_pretty(&export_settings(&settings, &now))
            .map_err(|_| Msg::FileError)?;
        file.replace_contents_future(bytes, None, false, gio::FileCreateFlags::PRIVATE)
            .await
            .map_err(|_| Msg::FileError)?;
    } else {
        let (bytes, _) = file
            .load_contents_future()
            .await
            .map_err(|_| Msg::FileError)?;
        let json = std::str::from_utf8(&bytes).map_err(|_| Msg::ImportError)?;
        let data = ExportFile::decode(json).map_err(|_| Msg::ImportError)?;
        services
            .change(move |s| merge_export(data, s))
            .await
            .map_err(|_| Msg::FileError)?;
    }
    Ok(true)
}

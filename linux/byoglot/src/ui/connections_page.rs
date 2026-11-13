use crate::{
    i18n::{Msg, tr},
    services::Services,
    ui::{
        connection_dialog,
        main_window::{banner, page_box, scroll, show_error},
    },
};
use adw::prelude::*;
use byoglot_core::{SettingsRepository, needs_key};
use gtk::glib;
use std::sync::Arc;

pub fn build(services: Arc<Services>, window: &adw::ApplicationWindow) -> gtk::ScrolledWindow {
    let content = page_box();
    let error = banner();
    content.append(&error);
    let add = gtk::Button::builder()
        .label(tr(Msg::AddConnection))
        .halign(gtk::Align::Start)
        .build();
    content.append(&add);
    let list = gtk::Box::new(gtk::Orientation::Vertical, 12);
    content.append(&list);
    let weak_window = window.downgrade();
    let weak_list = list.downgrade();
    let service = services.clone();
    let error_add = error.clone();
    add.connect_clicked(move |_| {
        if let (Some(window), Some(list)) = (weak_window.upgrade(), weak_list.upgrade()) {
            let service = service.clone();
            let weak_window = window.downgrade();
            let weak_list = list.downgrade();
            let error = error_add.clone();
            connection_dialog::present(&window, service.clone(), None, move || {
                if let (Some(list), Some(window)) = (weak_list.upgrade(), weak_window.upgrade()) {
                    refresh(service.clone(), &list, &window, &error);
                }
            });
        }
    });
    let weak_window = window.downgrade();
    let weak_list = list.downgrade();
    let root = scroll(&content);
    root.connect_map(move |_| {
        if let (Some(list), Some(window)) = (weak_list.upgrade(), weak_window.upgrade()) {
            refresh(services.clone(), &list, &window, &error);
        }
    });
    root
}

fn refresh(
    services: Arc<Services>,
    list: &gtk::Box,
    window: &adw::ApplicationWindow,
    error: &adw::Banner,
) {
    let list = list.clone();
    let window = window.clone();
    let error = error.clone();
    glib::spawn_future_local(async move {
        let settings = services.settings.read().await;
        let mut key_states = Vec::new();
        for connection in &settings.connections {
            key_states.push(services.key_state(connection.id.clone()).await);
        }
        while let Some(child) = list.first_child() {
            list.remove(&child);
        }
        if settings.connections.is_empty() {
            list.append(&gtk::Label::new(Some(tr(Msg::NoConnections))));
        }
        for (connection, key_state) in settings.connections.into_iter().zip(key_states) {
            let group = adw::PreferencesGroup::new();
            let row = adw::ActionRow::builder()
                .title(&connection.name)
                .subtitle(&connection.base_url)
                .use_markup(false)
                .build();
            let active = settings.active_connection_id.as_ref() == Some(&connection.id);
            match key_state {
                Ok(false) if needs_key(connection.preset, &connection.base_url) => {
                    row.add_prefix(&gtk::Label::new(Some(tr(Msg::KeyMissing))))
                }
                Err(problem) => show_error(&error, &problem),
                _ => (),
            }
            let activate = gtk::Button::builder()
                .label(tr(if active { Msg::Active } else { Msg::MakeActive }))
                .sensitive(!active)
                .valign(gtk::Align::Center)
                .build();
            let service = services.clone();
            let id = connection.id.clone();
            let weak_window = window.downgrade();
            let weak_list = list.downgrade();
            let error_activate = error.clone();
            activate.connect_clicked(move |_| {
                let service = service.clone();
                let id = id.clone();
                let error = error_activate.clone();
                let window = weak_window.clone();
                let list = weak_list.clone();
                glib::spawn_future_local(async move {
                    match service
                        .change(move |mut s| {
                            s.active_connection_id = Some(id);
                            s
                        })
                        .await
                    {
                        Ok(_) => {
                            if let (Some(list), Some(window)) = (list.upgrade(), window.upgrade()) {
                                refresh(service, &list, &window, &error);
                            }
                        }
                        Err(problem) => show_error(&error, &problem),
                    }
                });
            });
            row.add_suffix(&activate);
            let edit = gtk::Button::builder()
                .label(tr(Msg::Edit))
                .valign(gtk::Align::Center)
                .build();
            let service = services.clone();
            let existing = connection.clone();
            let weak_window = window.downgrade();
            let weak_list = list.downgrade();
            let error_edit = error.clone();
            edit.connect_clicked(move |_| {
                if let Some(window) = weak_window.upgrade() {
                    let window_weak = weak_window.clone();
                    let list = weak_list.clone();
                    let error = error_edit.clone();
                    let service = service.clone();
                    connection_dialog::present(
                        &window,
                        service.clone(),
                        Some(existing.clone()),
                        move || {
                            if let (Some(list), Some(window)) =
                                (list.upgrade(), window_weak.upgrade())
                            {
                                refresh(service.clone(), &list, &window, &error);
                            }
                        },
                    );
                }
            });
            row.add_suffix(&edit);
            let delete = gtk::Button::builder()
                .label(tr(Msg::Delete))
                .valign(gtk::Align::Center)
                .build();
            let service = services.clone();
            let id = connection.id;
            let weak_window = window.downgrade();
            let error_delete = error.clone();
            let weak_list = list.downgrade();
            delete.connect_clicked(move |_| {
                let Some(window) = weak_window.upgrade() else {
                    return;
                };
                let service = service.clone();
                let id = id.clone();
                let error = error_delete.clone();
                let list = weak_list.clone();
                glib::spawn_future_local(async move {
                    if super::main_window::confirm_delete(&window, Msg::DeleteConnection).await {
                        match service.remove_connection(id).await {
                            Ok(()) => {
                                if let Some(list) = list.upgrade() {
                                    refresh(service, &list, &window, &error);
                                }
                            }
                            Err(problem) => show_error(&error, &problem),
                        }
                    }
                });
            });
            row.add_suffix(&delete);
            group.add(&row);
            list.append(&group);
        }
    });
}

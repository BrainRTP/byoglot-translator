use crate::{
    i18n::{Msg, tr, tr_with},
    services::Services,
    ui::{
        main_window::{banner, confirm_delete, page_box, scroll, show_error},
        template_dialog,
    },
    view_state::delete_template,
};
use adw::prelude::*;
use byoglot_core::SettingsRepository;
use gtk::glib;
use std::sync::Arc;

pub fn build(services: Arc<Services>, window: &adw::ApplicationWindow) -> gtk::ScrolledWindow {
    let content = page_box();
    let error = banner();
    content.append(&error);
    let add = gtk::Button::builder()
        .label(tr(Msg::AddTemplate))
        .halign(gtk::Align::Start)
        .build();
    content.append(&add);
    let list = gtk::Box::new(gtk::Orientation::Vertical, 12);
    content.append(&list);
    let service = services.clone();
    let weak_window = window.downgrade();
    let weak_list = list.downgrade();
    let error_add = error.clone();
    add.connect_clicked(move |_| {
        if let Some(window) = weak_window.upgrade() {
            let list = weak_list.clone();
            let weak = weak_window.clone();
            let service = service.clone();
            let error = error_add.clone();
            template_dialog::present(&window, service.clone(), None, move || {
                if let (Some(list), Some(window)) = (list.upgrade(), weak.upgrade()) {
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
        while let Some(child) = list.first_child() {
            list.remove(&child);
        }
        for template in settings.templates {
            let group = adw::PreferencesGroup::new();
            let row = adw::ActionRow::builder()
                .title(if template.builtin {
                    tr(Msg::Builtin)
                } else {
                    &template.name
                })
                .use_markup(false)
                .build();
            for duplicate in [false, true] {
                if template.builtin && !duplicate {
                    continue;
                }
                let button = gtk::Button::builder()
                    .label(tr(if duplicate { Msg::Duplicate } else { Msg::Edit }))
                    .valign(gtk::Align::Center)
                    .build();
                let template = template.clone();
                let service = services.clone();
                let weak_window = window.downgrade();
                let weak_list = list.downgrade();
                let error = error.clone();
                button.connect_clicked(move |_| {
                    let Some(window) = weak_window.upgrade() else {
                        return;
                    };
                    let mut template = template.clone();
                    if duplicate {
                        template.id = crate::view_state::new_id("template");
                        template.builtin = false;
                        template.name = tr_with(
                            Msg::CopyName,
                            if template.name.is_empty() {
                                tr(Msg::Builtin)
                            } else {
                                &template.name
                            },
                        );
                    }
                    let list = weak_list.clone();
                    let weak = weak_window.clone();
                    let error = error.clone();
                    let service = service.clone();
                    template_dialog::present(&window, service.clone(), Some(template), move || {
                        if let (Some(list), Some(window)) = (list.upgrade(), weak.upgrade()) {
                            refresh(service.clone(), &list, &window, &error);
                        }
                    });
                });
                row.add_suffix(&button);
            }
            if !template.builtin {
                let delete = gtk::Button::builder()
                    .label(tr(Msg::Delete))
                    .valign(gtk::Align::Center)
                    .build();
                let service = services.clone();
                let id = template.id;
                let weak_window = window.downgrade();
                let weak_list = list.downgrade();
                let error = error.clone();
                delete.connect_clicked(move |_| {
                    let Some(window) = weak_window.upgrade() else {
                        return;
                    };
                    let service = service.clone();
                    let id = id.clone();
                    let list = weak_list.clone();
                    let error = error.clone();
                    glib::spawn_future_local(async move {
                        if confirm_delete(&window, Msg::DeleteTemplate).await {
                            match service
                                .change(move |mut s| {
                                    delete_template(&mut s, &id);
                                    s
                                })
                                .await
                            {
                                Ok(_) => {
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
            }
            group.add(&row);
            list.append(&group);
        }
    });
}

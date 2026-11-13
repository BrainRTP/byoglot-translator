use crate::{
    i18n::{Msg, language_name, tr},
    services::Services,
    ui::{
        error_text::connection_fix,
        main_window::{banner, combo, page_box, scroll, show_error},
    },
    view_state::RequestState,
};
use adw::prelude::*;
use byoglot_core::{EDITOR_INPUT_LIMIT, RunnerInput, SettingsRepository, contracts};
use gtk::glib;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

pub fn build(services: Arc<Services>, stack: &adw::ViewStack) -> gtk::ScrolledWindow {
    let content = page_box();
    let error = banner();
    error.set_button_label(Some(tr(Msg::FixConnection)));
    let weak_stack = stack.downgrade();
    error.connect_button_clicked(move |_| {
        if let Some(stack) = weak_stack.upgrade() {
            stack.set_visible_child_name("connections");
        }
    });
    content.append(&error);
    let group = adw::PreferencesGroup::new();
    let mut source_codes = vec!["auto".to_string()];
    source_codes.extend_from_slice(contracts::language_codes());
    let target_codes = contracts::language_codes().to_vec();
    let source = combo(
        tr(Msg::SourceLanguage),
        &source_codes
            .iter()
            .map(|s| language_name(s))
            .collect::<Vec<_>>(),
        0,
    );
    let target = combo(
        tr(Msg::TargetLanguage),
        &target_codes
            .iter()
            .map(|s| language_name(s))
            .collect::<Vec<_>>(),
        0,
    );
    let template = combo(tr(Msg::Template), &[tr(Msg::Builtin).into()], 0);
    group.add(&source);
    group.add(&target);
    group.add(&template);
    content.append(&group);
    let label = gtk::Label::builder()
        .label(tr(Msg::Input))
        .xalign(0.0)
        .build();
    content.append(&label);
    let input = gtk::TextView::builder()
        .wrap_mode(gtk::WrapMode::WordChar)
        .top_margin(12)
        .bottom_margin(12)
        .left_margin(12)
        .right_margin(12)
        .height_request(180)
        .vexpand(true)
        .tooltip_text(tr(Msg::InputLimit))
        .build();
    let input_scroll = scroll(&input);
    input_scroll.set_min_content_height(180);
    input_scroll.add_css_class("card");
    content.append(&input_scroll);
    let actions = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    let paste = gtk::Button::with_label(tr(Msg::Paste));
    let translate = gtk::Button::with_label(tr(Msg::Translate));
    translate.add_css_class("suggested-action");
    actions.append(&paste);
    actions.append(&translate);
    content.append(&actions);
    let result = gtk::Label::builder()
        .wrap(true)
        .selectable(true)
        .xalign(0.0)
        .yalign(0.0)
        .visible(false)
        .build();
    let copy = gtk::Button::builder()
        .label(tr(Msg::Copy))
        .halign(gtk::Align::Start)
        .visible(false)
        .build();
    content.append(
        &gtk::Label::builder()
            .label(tr(Msg::Result))
            .xalign(0.0)
            .build(),
    );
    content.append(&result);
    content.append(&copy);
    let weak_input = input.downgrade();
    paste.connect_clicked(move |_| {
        if let Some(input) = weak_input.upgrade() {
            glib::spawn_future_local(async move {
                if let Ok(Some(text)) = input.clipboard().read_text_future().await {
                    input.buffer().set_text(&text);
                    input.grab_focus();
                }
            });
        }
    });
    let weak_result = result.downgrade();
    copy.connect_clicked(move |button| {
        if let Some(result) = weak_result.upgrade() {
            button.clipboard().set_text(&result.text());
        }
    });
    let source_codes = Rc::new(source_codes);
    let target_codes = Rc::new(target_codes);
    let templates = Rc::new(RefCell::new(Vec::<String>::new()));
    let loading = Rc::new(Cell::new(true));
    let template_row = template.downgrade();
    for (row, codes, is_source) in [
        (source.clone(), source_codes.clone(), true),
        (target.clone(), target_codes.clone(), false),
    ] {
        let services = services.clone();
        let loading = loading.clone();
        let error = error.clone();
        row.connect_selected_notify(move |row| {
            if loading.get() {
                return;
            }
            let Some(code) = codes.get(row.selected() as usize).cloned() else {
                return;
            };
            let services = services.clone();
            let error = error.clone();
            glib::spawn_future_local(async move {
                if let Err(problem) = services
                    .change(move |mut s| {
                        if is_source {
                            s.globals.source_lang = code;
                        } else {
                            s.globals.target_lang = code;
                        }
                        s
                    })
                    .await
                {
                    show_error(&error, &problem);
                }
            });
        });
    }
    let ids = templates.clone();
    let service = services.clone();
    let guard = loading.clone();
    let error_template = error.clone();
    template.connect_selected_notify(move |row| {
        if guard.get() {
            return;
        }
        let Some(id) = ids.borrow().get(row.selected() as usize).cloned() else {
            return;
        };
        let service = service.clone();
        let error = error_template.clone();
        glib::spawn_future_local(async move {
            if let Err(problem) = service
                .change(move |mut s| {
                    s.globals.default_template_id = id;
                    s
                })
                .await
            {
                show_error(&error, &problem);
            }
        });
    });
    let source_run = source.clone();
    let target_run = target.clone();
    let source_ids = source_codes.clone();
    let target_ids = target_codes.clone();
    let state = Rc::new(RefCell::new(RequestState::default()));
    let task = Rc::new(RefCell::new(None::<glib::JoinHandle<()>>));
    let running = task.clone();
    let request_state = state.clone();
    let services_run = services.clone();
    let templates_run = templates.clone();
    let result_run = result.clone();
    let copy_run = copy.clone();
    let error_run = error.clone();
    let loaded = loading.clone();
    translate.connect_clicked(move |button| {
        if loaded.get() {
            return;
        }
        if let Some(old) = running.borrow_mut().take() {
            request_state.borrow_mut().cancel();
            old.abort();
            button.set_label(tr(Msg::Translate));
            return;
        }
        let buffer = input.buffer();
        let text = buffer
            .text(&buffer.start_iter(), &buffer.end_iter(), false)
            .to_string();
        let source = source_ids[source_run.selected() as usize].clone();
        let target = target_ids[target_run.selected() as usize].clone();
        let request = request_state.borrow_mut().begin();
        let template_id = templates_run
            .borrow()
            .get(template.selected() as usize)
            .cloned();
        let services = services_run.clone();
        let state = request_state.clone();
        let task = running.clone();
        let result = result_run.clone();
        let copy = copy_run.clone();
        let error = error_run.clone();
        let button = button.clone();
        error.set_revealed(false);
        result.set_visible(false);
        copy.set_visible(false);
        button.set_label(tr(Msg::Cancel));
        *running.borrow_mut() = Some(glib::spawn_future_local(async move {
            let output = match services
                .change(move |mut s| {
                    s.globals.source_lang = source;
                    s.globals.target_lang = target;
                    s
                })
                .await
            {
                Ok(_) => {
                    services
                        .translate(RunnerInput {
                            text,
                            context: String::new(),
                            app_name: "ByoGlot".into(),
                            template_id,
                            target_lang: None,
                            limit: EDITOR_INPUT_LIMIT,
                        })
                        .await
                }
                Err(problem) => Err(problem),
            };
            if !state.borrow_mut().finish(request) {
                return;
            }
            task.borrow_mut().take();
            button.set_label(tr(Msg::Translate));
            match output {
                Ok(output) => {
                    result.set_text(&output.text);
                    result.set_visible(true);
                    copy.set_visible(true);
                }
                Err(problem) => {
                    error
                        .set_button_label(connection_fix(&problem).then(|| tr(Msg::FixConnection)));
                    show_error(&error, &problem);
                }
            }
        }));
    });
    let root = scroll(&content);
    root.connect_unrealize(move |_| {
        state.borrow_mut().cancel();
        if let Some(task) = task.borrow_mut().take() {
            task.abort();
        }
    });
    let weak_source = source.downgrade();
    let weak_target = target.downgrade();
    root.connect_map(move |_| {
        let services = services.clone();
        let source = weak_source.clone();
        let target = weak_target.clone();
        let template_row = template_row.clone();
        let source_codes = source_codes.clone();
        let target_codes = target_codes.clone();
        let templates = templates.clone();
        let loading = loading.clone();
        glib::spawn_future_local(async move {
            let settings = services.settings.read().await;
            loading.set(true);
            if let Some(source) = source.upgrade() {
                source.set_selected(
                    source_codes
                        .iter()
                        .position(|s| *s == settings.globals.source_lang)
                        .unwrap_or(0) as u32,
                );
            }
            if let Some(target) = target.upgrade() {
                target.set_selected(
                    target_codes
                        .iter()
                        .position(|s| *s == settings.globals.target_lang)
                        .unwrap_or(0) as u32,
                );
            }
            if let Some(row) = template_row.upgrade() {
                let names: Vec<_> = settings
                    .templates
                    .iter()
                    .map(|t| {
                        if t.builtin {
                            tr(Msg::Builtin)
                        } else {
                            t.name.as_str()
                        }
                    })
                    .collect();
                row.set_model(Some(&gtk::StringList::new(&names)));
                row.set_selected(
                    settings
                        .templates
                        .iter()
                        .position(|t| t.id == settings.globals.default_template_id)
                        .unwrap_or(0) as u32,
                );
                *templates.borrow_mut() = settings.templates.into_iter().map(|t| t.id).collect();
            }
            loading.set(false);
        });
    });
    root
}

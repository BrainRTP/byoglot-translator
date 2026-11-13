use crate::{
    i18n::{Msg, language_name, tr},
    services::Services,
    ui::main_window::{banner, combo, page_box, scroll},
    view_state::{RequestState, editor_input, template_target},
};
use adw::prelude::*;
use byoglot_core::{SettingsRepository, Template, contracts};
use gtk::glib;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

pub fn build(
    services: Arc<Services>,
    stack: &adw::ViewStack,
    window: &adw::ApplicationWindow,
) -> gtk::ScrolledWindow {
    let content = page_box();
    let error = banner();
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
    let load = gtk::gio::SimpleAction::new("load-text", Some(glib::VariantTy::STRING));
    let input_weak = input.downgrade();
    let stack_weak = stack.downgrade();
    load.connect_activate(move |_, value| {
        if let (Some(input), Some(stack), Some(text)) = (
            input_weak.upgrade(),
            stack_weak.upgrade(),
            value.and_then(|v| v.str()),
        ) {
            stack.set_visible_child_name("translate");
            input.buffer().set_text(text);
            input.grab_focus();
        }
    });
    window.add_action(&load);
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
    let target_codes = Rc::new(RefCell::new(target_codes));
    let templates = Rc::new(RefCell::new(Vec::<Template>::new()));
    let loading = Rc::new(Cell::new(true));
    let template_row = template.downgrade();
    for (row, is_source) in [(source.clone(), true), (target.clone(), false)] {
        let source_codes = source_codes.clone();
        let target_codes = target_codes.clone();
        let services = services.clone();
        let loading = loading.clone();
        let error = error.clone();
        row.connect_selected_notify(move |row| {
            if loading.get() {
                return;
            }
            let code = if is_source {
                source_codes.get(row.selected() as usize).cloned()
            } else {
                target_codes.borrow().get(row.selected() as usize).cloned()
            };
            let Some(code) = code else {
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
    let target_template = target.clone();
    let target_languages = target_codes.clone();
    template.connect_selected_notify(move |row| {
        if guard.get() {
            return;
        }
        let Some(template) = ids.borrow().get(row.selected() as usize).cloned() else {
            return;
        };
        let current = target_languages
            .borrow()
            .get(target_template.selected() as usize)
            .cloned()
            .unwrap_or_else(|| "en".into());
        let language = template_target(&template, &current);
        if let Some(index) = target_languages
            .borrow()
            .iter()
            .position(|code| *code == language)
        {
            target_template.set_selected(index as u32);
        }
        let id = template.id;
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
        let target = target_ids.borrow()[target_run.selected() as usize].clone();
        let request_target = target.clone();
        let request = request_state.borrow_mut().begin();
        let template_id = templates_run
            .borrow()
            .get(template.selected() as usize)
            .map(|t| t.id.clone());
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
                        .translate(editor_input(text, template_id, request_target))
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
                for code in std::iter::once(&settings.globals.target_lang).chain(
                    settings
                        .templates
                        .iter()
                        .filter_map(|t| t.settings.target_lang.as_ref()),
                ) {
                    if !target_codes.borrow().contains(code) {
                        target_codes.borrow_mut().push(code.clone());
                    }
                }
                let names: Vec<_> = target_codes
                    .borrow()
                    .iter()
                    .map(|code| language_name(code))
                    .collect();
                let labels: Vec<_> = names.iter().map(String::as_str).collect();
                target.set_model(Some(&gtk::StringList::new(&labels)));
                target.set_selected(
                    target_codes
                        .borrow()
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
                *templates.borrow_mut() = settings.templates;
            }
            loading.set(false);
        });
    });
    root
}

fn show_error(banner: &adw::Banner, error: &byoglot_core::RunnerError) {
    banner
        .set_button_label(super::error_text::connection_fix(error).then(|| tr(Msg::FixConnection)));
    super::main_window::show_error(banner, error);
}

use crate::{
    APP_ID,
    i18n::{Msg, tr},
    services::Services,
    ui::main_window,
};
use adw::prelude::*;
use gtk::{gio, glib};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

pub fn run() -> glib::ExitCode {
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(_) => return glib::ExitCode::FAILURE,
    };
    let app = adw::Application::builder().application_id(APP_ID).build();
    let background = Rc::new(Cell::new(std::env::args().any(|arg| arg == "--background")));
    let hold = Rc::new(RefCell::new(None));
    let held = hold.clone();
    let startup_background = background.clone();
    app.connect_startup(move |app| {
        if startup_background.get() {
            *held.borrow_mut() = Some(app.hold());
        }
        let quit = gio::SimpleAction::new("quit", None);
        let weak = app.downgrade();
        quit.connect_activate(move |_, _| {
            if let Some(app) = weak.upgrade() {
                app.quit();
            }
        });
        app.add_action(&quit);
    });
    let services = Rc::new(RefCell::new(None::<std::sync::Arc<Services>>));
    let initializing = Rc::new(Cell::new(false));
    let handle = runtime.handle().clone();
    app.connect_activate(move |app| {
        if let Some(window) = app.active_window() {
            window.present();
            return;
        }
        if let Some(services) = services.borrow().clone() {
            if !background.replace(false) {
                main_window::build(app, services).present();
            }
            return;
        }
        if initializing.replace(true) {
            background.set(false);
            return;
        }
        let path = glib::user_config_dir().join("byoglot/settings.json");
        let language = glib::language_names().first().map(|s| s.to_string());
        let runtime_handle = handle.clone();
        let task = handle.spawn(async move { Services::new(path, language, runtime_handle).await });
        let app = app.clone();
        let services = services.clone();
        let initializing = initializing.clone();
        let background = background.clone();
        let pending_hold = app.hold();
        glib::spawn_future_local(async move {
            match task.await {
                Ok(Ok(ready)) => {
                    *services.borrow_mut() = Some(ready.clone());
                    if !background.replace(false) {
                        main_window::build(&app, ready).present();
                    }
                }
                _ => {
                    let window = adw::ApplicationWindow::builder()
                        .application(&app)
                        .title("ByoGlot")
                        .build();
                    window.set_content(Some(&gtk::Label::new(Some(tr(Msg::ErrOffline)))));
                    window.present();
                }
            }
            initializing.set(false);
            drop(pending_hold);
        });
    });
    let args: Vec<_> = std::env::args()
        .filter(|arg| arg != "--background")
        .collect();
    app.run_with_args(&args)
}

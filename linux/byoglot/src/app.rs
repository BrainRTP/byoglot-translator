use crate::{
    APP_ID,
    cli::{self, Command},
    i18n::{Msg, tr},
    quick::controller::gui::Driver,
    services::Services,
    settings_file::FileSettingsRepository,
    shortcut::Registration,
    ui::main_window,
};
use adw::prelude::*;
use gtk::{gio, glib};
use std::{cell::RefCell, path::PathBuf, rc::Rc, sync::Arc};

enum Pending {
    Main(Option<String>),
    Quick(Option<String>, Option<String>),
}
struct State {
    services: RefCell<Option<Arc<Services>>>,
    quick: RefCell<Option<Rc<Driver>>>,
    main: glib::WeakRef<adw::ApplicationWindow>,
    startup_error: glib::WeakRef<adw::ApplicationWindow>,
    pending: RefCell<Vec<Pending>>,
    hold: RefCell<Option<gio::ApplicationHoldGuard>>,
    token: RefCell<Option<String>>,
    shortcuts: Rc<Registration>,
}
impl State {
    fn dispatch(self: &Rc<Self>, app: &adw::Application, command: Pending) {
        let Some(services) = self.services.borrow().clone() else {
            self.pending.borrow_mut().push(command);
            if let Some(window) = self.startup_error.upgrade() {
                window.present();
            }
            return;
        };
        match command {
            Pending::Main(text) => {
                let window = self.main.upgrade().unwrap_or_else(|| {
                    let window = main_window::build(app, services, self.shortcuts.clone());
                    self.main.set(Some(&window));
                    window
                });
                window.present();
                if let Some(text) = text
                    && let Some(action) = window.lookup_action("load-text")
                {
                    action.activate(Some(&text.to_variant()));
                }
            }
            Pending::Quick(text, token) => {
                if let Some(quick) = self.quick.borrow().as_ref() {
                    quick.trigger(text, token.as_deref());
                }
            }
        }
    }

    fn initialize(
        self: &Rc<Self>,
        app: &adw::Application,
        path: PathBuf,
        language: Option<String>,
        handle: tokio::runtime::Handle,
        reset: bool,
    ) {
        *self.hold.borrow_mut() = Some(app.hold());
        let state = self.clone();
        let app = app.clone();
        let settings_path = path.clone();
        let preferred_language = language.clone();
        let runtime = handle.clone();
        let task = handle.spawn(async move {
            if reset {
                FileSettingsRepository::new(settings_path.clone(), preferred_language.clone())
                    .reset_invalid()?;
            }
            Services::new(settings_path, preferred_language, runtime).await
        });
        glib::spawn_future_local(async move {
            let outcome = task.await;
            if let Some(window) = state.startup_error.upgrade() {
                window.close();
            }
            match outcome {
                Ok(Ok(services)) => {
                    *state.quick.borrow_mut() = Some(Driver::new(&app, services.clone()));
                    *state.services.borrow_mut() = Some(services);
                    let pending = std::mem::take(&mut *state.pending.borrow_mut());
                    for command in pending {
                        state.dispatch(&app, command);
                    }
                    if reset {
                        state.dispatch(&app, Pending::Main(None));
                    }
                }
                error => {
                    let invalid =
                        matches!(error, Ok(Err(e)) if e.kind() == std::io::ErrorKind::InvalidData);
                    let window = adw::ApplicationWindow::builder()
                        .application(&app)
                        .title("ByoGlot")
                        .default_width(500)
                        .build();
                    let content = main_window::page_box();
                    let message = if invalid {
                        tr(Msg::ErrSettings)
                            .replacen("{}", &path.display().to_string(), 1)
                            .replacen(
                                "{}",
                                &path.with_extension("json.bad").display().to_string(),
                                1,
                            )
                    } else {
                        tr(Msg::ErrStorage).into()
                    };
                    content.append(
                        &gtk::Label::builder()
                            .label(message)
                            .wrap(true)
                            .selectable(true)
                            .build(),
                    );
                    if invalid {
                        let button = gtk::Button::with_label(tr(Msg::ResetSettings));
                        let state = state.clone();
                        let app = app.clone();
                        button.connect_clicked(move |button| {
                            button.set_sensitive(false);
                            state.initialize(
                                &app,
                                path.clone(),
                                language.clone(),
                                handle.clone(),
                                true,
                            );
                        });
                        content.append(&button);
                    }
                    window.set_content(Some(&content));
                    state.startup_error.set(Some(&window));
                    window.present();
                    state.hold.borrow_mut().take();
                }
            }
        });
    }
}

pub fn run() -> glib::ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let background = args.get(1).is_some_and(|a| a == "--background") && args.len() == 2;
    match cli::parse(args.get(1..).unwrap_or_default()) {
        Command::Help if !background => {
            println!("{}", tr(Msg::CliHelp));
            return glib::ExitCode::SUCCESS;
        }
        Command::Version => {
            println!("ByoGlot {}", env!("CARGO_PKG_VERSION"));
            return glib::ExitCode::SUCCESS;
        }
        _ => {}
    }
    if adw::init().is_err() {
        return glib::ExitCode::FAILURE;
    }
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(_) => return glib::ExitCode::FAILURE,
    };
    let _runtime_guard = runtime.enter();
    let app = adw::Application::builder()
        .application_id(APP_ID)
        .flags(gio::ApplicationFlags::HANDLES_COMMAND_LINE)
        .build();
    let state = Rc::new(State {
        services: RefCell::new(None),
        quick: RefCell::new(None),
        main: glib::WeakRef::new(),
        startup_error: glib::WeakRef::new(),
        pending: RefCell::new(Vec::new()),
        hold: RefCell::new(None),
        token: RefCell::new(None),
        shortcuts: Rc::new(Registration::default()),
    });
    let startup_state = state.clone();
    let handle = runtime.handle().clone();
    app.connect_startup(move |app| {
        let state = startup_state.clone();
        let quit = gio::SimpleAction::new("quit", None);
        let weak = app.downgrade();
        let quitting = state.clone();
        quit.connect_activate(move |_, _| {
            if let Some(app) = weak.upgrade() {
                let state = quitting.clone();
                glib::spawn_future_local(async move {
                    state.quick.borrow_mut().take();
                    state.shortcuts.shutdown();
                    let services = state.services.borrow().clone();
                    if let Some(services) = services {
                        services.wait_for_writes().await;
                    }
                    state.hold.borrow_mut().take();
                    app.quit();
                });
            }
        });
        app.add_action(&quit);
        let token = gio::SimpleAction::new("portal-token", Some(glib::VariantTy::STRING));
        let token_state = state.clone();
        token.connect_activate(move |_, value| {
            *token_state.token.borrow_mut() = value.and_then(|v| v.str()).map(str::to_owned);
        });
        app.add_action(&token);
        for (name, parameter) in [
            ("translate-selection", None),
            ("translate-text", Some(glib::VariantTy::STRING)),
            ("open-text", Some(glib::VariantTy::STRING)),
        ] {
            let action = gio::SimpleAction::new(name, parameter);
            let state = state.clone();
            let weak = app.downgrade();
            action.connect_activate(move |_, value| {
                if let Some(app) = weak.upgrade() {
                    let text = value.and_then(|v| v.str()).map(str::to_owned);
                    let pending = if name == "open-text" {
                        Pending::Main(text)
                    } else {
                        Pending::Quick(text, state.token.borrow_mut().take())
                    };
                    state.dispatch(&app, pending);
                }
            });
            app.add_action(&action);
        }
        state.shortcuts.start(app);
        let path = glib::user_config_dir().join("byoglot/settings.json");
        let language = glib::language_names().first().map(|s| s.to_string());
        state.initialize(app, path, language, handle.clone(), false);
    });
    let activate_state = state.clone();
    app.connect_activate(move |app| activate_state.dispatch(app, Pending::Main(None)));
    let command_state = state.clone();
    app.connect_command_line(move |app, command_line| {
        let args: Vec<String> = command_line
            .arguments()
            .iter()
            .skip(1)
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        if args == ["--background"] {
            return glib::ExitCode::SUCCESS;
        }
        match cli::parse(&args) {
            Command::Activate => app.activate(),
            Command::TranslateSelection => app.activate_action("translate-selection", None),
            Command::TranslateText(text) => {
                app.activate_action("translate-text", Some(&text.to_variant()))
            }
            Command::TranslateStdin => {
                let app = app.clone();
                let command_line = command_line.clone();
                let state = command_state.clone();
                glib::spawn_future_local(async move {
                    match read_stdin(&command_line).await {
                        Some(text) => state.dispatch(&app, Pending::Quick(Some(text), None)),
                        None => {
                            command_line.set_exit_code(glib::ExitCode::FAILURE);
                            let window = adw::ApplicationWindow::builder()
                                .application(&app)
                                .title("ByoGlot")
                                .build();
                            window.set_content(Some(&gtk::Label::new(Some(tr(Msg::StdinError)))));
                            window.present();
                        }
                    }
                });
            }
            Command::Help | Command::Version => {}
        }
        glib::ExitCode::SUCCESS
    });
    app.run_with_args(&args)
}

async fn read_stdin(command: &gio::ApplicationCommandLine) -> Option<String> {
    let input = command.stdin()?;
    let mut bytes = Vec::new();
    // More than this cannot fit the quick limit, even with four-byte UTF-8.
    const MAX_BYTES: usize = byoglot_core::QUICK_INPUT_LIMIT * 4 + 4;
    while bytes.len() < MAX_BYTES {
        let chunk = input
            .read_bytes_future((MAX_BYTES - bytes.len()).min(4096), glib::Priority::DEFAULT)
            .await
            .ok()?;
        if chunk.is_empty() {
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() == MAX_BYTES {
        return Some("x".repeat(byoglot_core::QUICK_INPUT_LIMIT + 1));
    }
    String::from_utf8(bytes).ok()
}

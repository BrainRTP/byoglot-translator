#![forbid(unsafe_code)]
use adw::prelude::*;
fn main() -> gtk::glib::ExitCode {
    let app = adw::Application::builder()
        .application_id(byoglot::APP_ID)
        .build();
    app.connect_activate(|app| {
        if let Some(window) = app.active_window() {
            window.present();
            return;
        }
        adw::ApplicationWindow::builder()
            .application(app)
            .title("ByoGlot")
            .default_width(800)
            .default_height(650)
            .build()
            .present();
    });
    app.run()
}

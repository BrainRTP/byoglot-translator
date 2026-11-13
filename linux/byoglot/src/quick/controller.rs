use byoglot_core::{QUICK_INPUT_LIMIT, QuickEffect, QuickEvent, QuickState, reduce};

pub struct QuickController {
    pub state: QuickState,
    generation: u64,
}
impl Default for QuickController {
    fn default() -> Self {
        Self {
            state: QuickState::Hidden,
            generation: 0,
        }
    }
}
impl QuickController {
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn apply(&mut self, event: QuickEvent) -> Vec<QuickEffect> {
        if matches!(
            event,
            QuickEvent::Triggered
                | QuickEvent::TriggeredWithText(_)
                | QuickEvent::Pasted(_)
                | QuickEvent::Dismissed
        ) {
            self.generation = self.generation.wrapping_add(1);
        }
        let state = std::mem::replace(&mut self.state, QuickState::Hidden);
        let (state, effects) = reduce(state, event, QUICK_INPUT_LIMIT);
        self.state = state;
        effects
    }
    pub fn accept(&self, generation: u64) -> bool {
        self.generation == generation
    }
    pub fn source(&self) -> Option<&str> {
        match &self.state {
            QuickState::Translating { source }
            | QuickState::Done { source, .. }
            | QuickState::Failed { source, .. } => Some(source),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_text_and_stale_selection_reads_keep_the_new_generation() {
        let mut controller = QuickController::default();
        controller.apply(QuickEvent::TriggeredWithText("same".into()));
        let old = controller.generation();
        let effects = controller.apply(QuickEvent::TriggeredWithText("same".into()));
        assert_eq!(effects.first(), Some(&QuickEffect::CancelTranslating));
        assert!(!controller.accept(old));
        assert!(controller.accept(controller.generation()));
        let reading = controller.generation();
        controller.apply(QuickEvent::Pasted("new".into()));
        assert!(!controller.accept(reading));
        let running = controller.generation();
        controller.apply(QuickEvent::Dismissed);
        assert!(!controller.accept(running));
    }
}

#[cfg(feature = "gui")]
pub mod gui {
    use super::*;
    use crate::{quick::window::QuickWindow, services::Services};
    use adw::prelude::*;
    use gtk::glib;
    use std::{cell::RefCell, rc::Rc, sync::Arc, time::Duration};

    pub struct Driver {
        pub window: QuickWindow,
        controller: RefCell<QuickController>,
        services: Arc<Services>,
        translation: RefCell<Option<glib::JoinHandle<()>>>,
        capture: RefCell<Option<glib::JoinHandle<()>>>,
        template: RefCell<Option<String>>,
    }
    impl Driver {
        pub fn new(app: &adw::Application, services: Arc<Services>) -> Rc<Self> {
            let driver = Rc::new(Self {
                window: QuickWindow::new(app),
                controller: RefCell::new(QuickController::default()),
                services,
                translation: RefCell::new(None),
                capture: RefCell::new(None),
                template: RefCell::new(None),
            });
            driver.window.connect(&driver, app);
            driver
        }
        pub fn trigger(self: &Rc<Self>, text: Option<String>, token: Option<&str>) {
            if let Some(token) = token {
                self.window.window.set_startup_id(token);
            }
            self.dispatch(text.map_or(QuickEvent::Triggered, QuickEvent::TriggeredWithText));
            let driver = Rc::downgrade(self);
            let generation = self.controller.borrow().generation();
            let services = self.services.clone();
            glib::spawn_future_local(async move {
                use byoglot_core::SettingsRepository;
                let settings = services.settings.read().await;
                if let Some(driver) = driver.upgrade()
                    && driver.controller.borrow().accept(generation)
                {
                    driver
                        .window
                        .set_templates(&settings.templates, &settings.globals.default_template_id);
                }
            });
        }
        pub fn choose_template(self: &Rc<Self>, id: String) {
            *self.template.borrow_mut() = Some(id);
            let source = self.controller.borrow().source().map(str::to_owned);
            if let Some(source) = source {
                self.dispatch(QuickEvent::Pasted(source));
            }
        }
        pub fn source(&self) -> Option<String> {
            self.controller.borrow().source().map(str::to_owned)
        }
        pub fn dispatch(self: &Rc<Self>, event: QuickEvent) {
            if matches!(
                event,
                QuickEvent::Triggered
                    | QuickEvent::TriggeredWithText(_)
                    | QuickEvent::Pasted(_)
                    | QuickEvent::Dismissed
            ) && let Some(task) = self.capture.borrow_mut().take()
            {
                task.abort();
            }
            let effects = self.controller.borrow_mut().apply(event);
            let state = self.controller.borrow().state.clone();
            self.window.render(&state);
            for effect in effects {
                match effect {
                    QuickEffect::PresentWindow => {
                        self.window.window.present();
                        if self.window.window.is_active() {
                            self.dispatch(QuickEvent::Focused);
                        }
                    }
                    QuickEffect::ReadPrimary => self.read(true),
                    QuickEffect::ReadClipboard => self.read(false),
                    QuickEffect::CancelTranslating => {
                        if let Some(task) = self.translation.borrow_mut().take() {
                            task.abort();
                        }
                    }
                    QuickEffect::StartTranslating(source) => self.translate(source),
                }
            }
        }
        fn read(self: &Rc<Self>, primary: bool) {
            if primary && self.capture.borrow().is_some() {
                return;
            }
            let generation = self.controller.borrow().generation();
            let display = gtk::prelude::WidgetExt::display(&self.window.window);
            let clipboard = if primary {
                display.primary_clipboard()
            } else {
                display.clipboard()
            };
            let driver = Rc::downgrade(self);
            *self.capture.borrow_mut() = Some(glib::spawn_future_local(async move {
                let text = glib::future_with_timeout(
                    Duration::from_millis(300),
                    clipboard.read_text_future(),
                )
                .await
                .ok()
                .and_then(Result::ok)
                .flatten()
                .map(|t| t.to_string());
                if let Some(driver) = driver.upgrade()
                    && driver.controller.borrow().accept(generation)
                {
                    driver.capture.borrow_mut().take();
                    driver.dispatch(if primary {
                        QuickEvent::PrimaryRead(text)
                    } else {
                        QuickEvent::ClipboardRead(text)
                    });
                }
            }));
        }
        fn translate(self: &Rc<Self>, source: String) {
            if let Some(task) = self.translation.borrow_mut().take() {
                task.abort();
            }
            let generation = self.controller.borrow().generation();
            let template_id = self.template.borrow().clone();
            let services = self.services.clone();
            let driver = Rc::downgrade(self);
            *self.translation.borrow_mut() = Some(glib::spawn_future_local(async move {
                let output = services
                    .translate(byoglot_core::RunnerInput {
                        text: source.clone(),
                        context: String::new(),
                        app_name: "ByoGlot".into(),
                        template_id,
                        target_lang: None,
                        limit: QUICK_INPUT_LIMIT,
                    })
                    .await;
                if let Some(driver) = driver.upgrade()
                    && driver.controller.borrow().accept(generation)
                {
                    driver.translation.borrow_mut().take();
                    driver.dispatch(match output {
                        Ok(output) => QuickEvent::Finished { source, output },
                        Err(error) => QuickEvent::FailedWith { source, error },
                    });
                }
            }));
        }
    }
    impl Drop for Driver {
        fn drop(&mut self) {
            if let Some(task) = self.translation.get_mut().take() {
                task.abort();
            }
            if let Some(task) = self.capture.get_mut().take() {
                task.abort();
            }
        }
    }
}

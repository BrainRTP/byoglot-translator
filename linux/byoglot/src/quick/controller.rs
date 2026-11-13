use crate::view_state::{editor_input, template_target};
use byoglot_core::{
    AppSettings, QUICK_INPUT_LIMIT, QuickEffect, QuickEvent, QuickState, Template, contracts,
    reduce,
};

pub enum Event<'a> {
    State(QuickEvent),
    SettingsLoaded {
        session: u64,
        settings: &'a AppSettings,
    },
    TemplateSelected(String),
    TargetSelected(String),
}

pub struct QuickController {
    pub state: QuickState,
    pub templates: Vec<Template>,
    pub template_id: String,
    pub target_lang: String,
    pub ready: bool,
    default_template_id: String,
    default_target_lang: String,
    generation: u64,
    session: u64,
}
impl Default for QuickController {
    fn default() -> Self {
        let settings = AppSettings::initial(None);
        let mut controller = Self {
            state: QuickState::Hidden,
            templates: Vec::new(),
            template_id: String::new(),
            target_lang: String::new(),
            ready: false,
            default_template_id: String::new(),
            default_target_lang: String::new(),
            generation: 0,
            session: 0,
        };
        controller.configure(&settings);
        controller
    }
}
impl QuickController {
    fn configure(&mut self, settings: &AppSettings) {
        self.templates = settings.templates.clone();
        if !self
            .templates
            .iter()
            .any(|t| t.id == contracts::builtin_template().id)
        {
            self.templates.push(contracts::builtin_template().clone());
        }
        self.default_template_id = settings.globals.default_template_id.clone();
        self.default_target_lang = settings.globals.target_lang.clone();
        self.reset_choices();
    }
    fn reset_choices(&mut self) {
        let template = self
            .templates
            .iter()
            .find(|t| t.id == self.default_template_id)
            .unwrap_or(contracts::builtin_template());
        self.template_id = template.id.clone();
        self.target_lang = template_target(template, &self.default_target_lang);
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn session(&self) -> u64 {
        self.session
    }
    pub fn apply(&mut self, event: Event<'_>) -> Vec<QuickEffect> {
        let event = match event {
            Event::State(event) => event,
            Event::SettingsLoaded { session, settings } => {
                if session != self.session || self.ready || self.state == QuickState::Hidden {
                    return Vec::new();
                }
                self.configure(settings);
                self.ready = true;
                return match &self.state {
                    QuickState::Translating { source } => {
                        vec![QuickEffect::StartTranslating(source.clone())]
                    }
                    _ => Vec::new(),
                };
            }
            Event::TemplateSelected(id) => {
                let Some(template) = self.templates.iter().find(|t| self.ready && t.id == id)
                else {
                    return Vec::new();
                };
                self.target_lang = template_target(template, &self.target_lang);
                self.template_id = id;
                let Some(source) = self.source() else {
                    return Vec::new();
                };
                QuickEvent::Pasted(source.to_owned())
            }
            Event::TargetSelected(target) => {
                if !self.ready
                    || (!contracts::language_codes().contains(&target)
                        && target != self.target_lang)
                {
                    return Vec::new();
                }
                self.target_lang = target;
                let Some(source) = self.source() else {
                    return Vec::new();
                };
                QuickEvent::Pasted(source.to_owned())
            }
        };
        if matches!(
            event,
            QuickEvent::Triggered | QuickEvent::TriggeredWithText(_) | QuickEvent::Dismissed
        ) {
            self.session = self.session.wrapping_add(1);
            self.ready = false;
            self.reset_choices();
        }
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
        let (state, mut effects) = reduce(state, event, QUICK_INPUT_LIMIT);
        if let QuickState::Done { output, .. } = &state {
            self.target_lang = output.target_lang.clone();
        }
        self.state = state;
        if !self.ready {
            effects.retain(|effect| !matches!(effect, QuickEffect::StartTranslating(_)));
        }
        effects
    }
    pub fn input(&self, text: String) -> byoglot_core::RunnerInput {
        let mut input = editor_input(
            text,
            Some(self.template_id.clone()),
            self.target_lang.clone(),
        );
        input.limit = QUICK_INPUT_LIMIT;
        input
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
    fn settings() -> AppSettings {
        let mut settings = AppSettings::initial(None);
        settings.globals.target_lang = "en".into();
        settings.templates[0].settings.target_lang = None;
        let mut formal = settings.templates[0].clone();
        formal.id = "formal".into();
        formal.name = "Formal".into();
        formal.builtin = false;
        formal.settings.target_lang = Some("fr".into());
        settings.templates.push(formal);
        settings
    }
    fn trigger(controller: &mut QuickController) {
        controller.apply(Event::State(QuickEvent::TriggeredWithText("same".into())));
        controller.apply(Event::SettingsLoaded {
            session: controller.session(),
            settings: &settings(),
        });
    }
    #[test]
    fn choices_reset_and_templates_move_the_target_before_manual_picks_win() {
        let mut controller = QuickController::default();
        trigger(&mut controller);
        let defaults = controller.template_id.clone();
        let generation = controller.generation();
        let effects = controller.apply(Event::TemplateSelected("formal".into()));
        assert_eq!(controller.template_id, "formal");
        assert_eq!(controller.target_lang, "fr");
        assert_eq!(
            effects,
            vec![
                QuickEffect::CancelTranslating,
                QuickEffect::StartTranslating("same".into())
            ]
        );
        assert!(!controller.accept(generation));
        controller.apply(Event::TargetSelected("de".into()));
        assert_eq!(controller.target_lang, "de");
        let input = controller.input("same".into());
        assert_eq!(input.target_lang.as_deref(), Some("de"));
        assert_eq!(input.template_id.as_deref(), Some("formal"));
        assert_eq!(input.limit, QUICK_INPUT_LIMIT);
        controller.apply(Event::State(QuickEvent::Finished {
            source: "same".into(),
            output: byoglot_core::RunnerOutput {
                text: "result".into(),
                source_lang: "en".into(),
                target_lang: "de-DE".into(),
                model: contracts::favorite_model().clone(),
            },
        }));
        assert_eq!(controller.target_lang, "de-DE");
        controller.apply(Event::TargetSelected("de".into()));
        controller.apply(Event::TemplateSelected(defaults.clone()));
        assert_eq!(controller.target_lang, "de");
        controller.apply(Event::TemplateSelected("formal".into()));
        assert_eq!(controller.target_lang, "fr");
        controller.apply(Event::State(QuickEvent::Dismissed));
        assert_eq!(controller.template_id, defaults);
        assert_eq!(controller.target_lang, "en");
        trigger(&mut controller);
        controller.apply(Event::TargetSelected("de".into()));
        trigger(&mut controller);
        assert_eq!(controller.template_id, defaults);
        assert_eq!(controller.target_lang, "en");
    }
    #[test]
    fn settings_wait_for_the_current_trigger_but_survive_a_paste() {
        let mut controller = QuickController::default();
        controller.apply(Event::State(QuickEvent::Triggered));
        let old = controller.session();
        controller.apply(Event::State(QuickEvent::Triggered));
        assert!(
            controller
                .apply(Event::SettingsLoaded {
                    session: old,
                    settings: &settings()
                })
                .is_empty()
        );
        assert!(!controller.ready);
        assert!(
            controller
                .apply(Event::State(QuickEvent::Pasted("text".into())))
                .is_empty()
        );
        assert_eq!(
            controller.apply(Event::SettingsLoaded {
                session: controller.session(),
                settings: &settings()
            }),
            vec![QuickEffect::StartTranslating("text".into())]
        );
        assert!(controller.ready);
    }
    #[test]
    fn repeated_text_and_stale_selection_reads_keep_the_new_generation() {
        let mut controller = QuickController::default();
        trigger(&mut controller);
        let old = controller.generation();
        let effects = controller.apply(Event::State(QuickEvent::TriggeredWithText("same".into())));
        assert_eq!(effects.first(), Some(&QuickEffect::CancelTranslating));
        assert!(!controller.accept(old));
        assert!(controller.accept(controller.generation()));
        let reading = controller.generation();
        controller.apply(Event::State(QuickEvent::Pasted("new".into())));
        assert!(!controller.accept(reading));
        let running = controller.generation();
        controller.apply(Event::State(QuickEvent::Dismissed));
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
    }
    impl Driver {
        pub fn new(app: &adw::Application, services: Arc<Services>) -> Rc<Self> {
            let driver = Rc::new(Self {
                window: QuickWindow::new(app),
                controller: RefCell::new(QuickController::default()),
                services,
                translation: RefCell::new(None),
                capture: RefCell::new(None),
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
            let session = self.controller.borrow().session();
            let services = self.services.clone();
            glib::spawn_future_local(async move {
                use byoglot_core::SettingsRepository;
                let settings = services.settings.read().await;
                if let Some(driver) = driver.upgrade() {
                    driver.update(Event::SettingsLoaded {
                        session,
                        settings: &settings,
                    });
                }
            });
        }
        pub fn choose_template(self: &Rc<Self>, id: String) {
            self.update(Event::TemplateSelected(id));
        }
        pub fn choose_target(self: &Rc<Self>, target: String) {
            self.update(Event::TargetSelected(target));
        }
        pub fn generation(&self) -> u64 {
            self.controller.borrow().generation()
        }
        pub fn accepts(&self, generation: u64) -> bool {
            self.controller.borrow().accept(generation)
        }
        pub fn source(&self) -> Option<String> {
            self.controller.borrow().source().map(str::to_owned)
        }
        pub fn dispatch(self: &Rc<Self>, event: QuickEvent) {
            self.update(Event::State(event));
        }
        fn update(self: &Rc<Self>, event: Event<'_>) {
            if matches!(
                &event,
                Event::State(QuickEvent::Triggered | QuickEvent::TriggeredWithText(_))
            ) {
                self.window.clear_entry();
            }
            if matches!(
                &event,
                Event::State(
                    QuickEvent::Triggered
                        | QuickEvent::TriggeredWithText(_)
                        | QuickEvent::Pasted(_)
                        | QuickEvent::Dismissed
                ) | Event::TemplateSelected(_)
                    | Event::TargetSelected(_)
            ) && let Some(task) = self.capture.borrow_mut().take()
            {
                task.abort();
            }
            let effects = self.controller.borrow_mut().apply(event);
            let (state, templates, template_id, target, ready) = {
                let controller = self.controller.borrow();
                (
                    controller.state.clone(),
                    controller.templates.clone(),
                    controller.template_id.clone(),
                    controller.target_lang.clone(),
                    controller.ready,
                )
            };
            self.window
                .set_choices(&templates, &template_id, &target, ready);
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
            let input = self.controller.borrow().input(source.clone());
            let services = self.services.clone();
            let driver = Rc::downgrade(self);
            *self.translation.borrow_mut() = Some(glib::spawn_future_local(async move {
                let output = services.translate(input).await;
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

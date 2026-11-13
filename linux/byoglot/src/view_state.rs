use byoglot_core::{AppSettings, Template};

pub fn new_id(prefix: &str) -> String {
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{prefix}-{time:x}-{:x}",
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn remote_origin(url: &str) -> Option<String> {
    let origin = byoglot_core::origin_of(url.trim())?;
    let parsed = reqwest::Url::parse(&origin).ok()?;
    (!parsed.host_str().is_some_and(byoglot_core::is_local_host)).then_some(origin)
}

pub fn model_choices(
    models: &[byoglot_core::ModelInfo],
    connection_id: &str,
) -> Vec<byoglot_core::ModelRef> {
    models
        .iter()
        .flat_map(|model| {
            let variants = if model.variants.is_empty() {
                vec![None]
            } else {
                model.variants.iter().cloned().map(Some).collect()
            };
            variants
                .into_iter()
                .map(move |variant| byoglot_core::ModelRef {
                    provider_id: model.provider_id.clone(),
                    id: model.id.clone(),
                    variant,
                    connection_id: Some(connection_id.into()),
                })
        })
        .collect()
}

pub fn save_profile(settings: &mut AppSettings, id: &str, text: Option<String>) -> bool {
    let Some(base) = byoglot_core::contracts::builtin_profiles().get(id) else {
        return false;
    };
    if let Some(text) = text {
        if text.encode_utf16().count() > byoglot_core::contracts::limits().max_profile_text {
            return false;
        }
        let saved_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
            * 1000.0;
        settings.profile_overrides.insert(
            id.into(),
            byoglot_core::ProfileOverride {
                text,
                base: base.clone(),
                saved_at,
            },
        );
    } else {
        settings.profile_overrides.remove(id);
    }
    true
}

#[derive(Default)]
pub struct RequestState {
    generation: u64,
    active: Option<u64>,
}
impl RequestState {
    pub fn begin(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.active = Some(self.generation);
        self.generation
    }
    pub fn cancel(&mut self) {
        self.active = None;
    }
    pub fn finish(&mut self, request: u64) -> bool {
        if self.active != Some(request) {
            return false;
        }
        self.active = None;
        true
    }
}

pub fn save_template(settings: &mut AppSettings, template: Template) -> bool {
    if template.builtin || template.name.trim().is_empty() {
        return false;
    }
    if let Some(current) = settings.templates.iter_mut().find(|t| t.id == template.id) {
        if current.builtin {
            return false;
        }
        *current = template;
    } else {
        settings.templates.push(template);
    }
    true
}
pub fn delete_template(settings: &mut AppSettings, id: &str) -> bool {
    if !settings.templates.iter().any(|t| t.id == id && !t.builtin) {
        return false;
    }
    settings.templates.retain(|t| t.id != id);
    if settings.globals.default_template_id == id {
        settings.globals.default_template_id =
            byoglot_core::contracts::builtin_template().id.clone();
    }
    for rule in &mut settings.site_rules {
        if rule.template_id == id {
            rule.template_id = settings.globals.default_template_id.clone();
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn template_updates_the_picker_and_manual_target_wins_for_requests() {
        let mut template = byoglot_core::contracts::builtin_template().clone();
        template.settings.target_lang = Some("fr".into());
        let picker = template_target(&template, "en");
        assert_eq!(picker, "fr");
        assert_eq!(
            editor_input("Hello".into(), Some(template.id.clone()), picker)
                .target_lang
                .as_deref(),
            Some("fr")
        );
        let manual = "de".to_string();
        assert_eq!(
            editor_input("Hello".into(), Some(template.id), manual)
                .target_lang
                .as_deref(),
            Some("de")
        );
    }
    #[test]
    fn late_results_never_replace_a_newer_request() {
        let mut state = RequestState::default();
        let old = state.begin();
        let new = state.begin();
        assert!(!state.finish(old));
        assert!(state.finish(new));
        let cancelled = state.begin();
        state.cancel();
        assert!(!state.finish(cancelled));
    }
    #[test]
    fn builtin_templates_cannot_be_changed_or_deleted() {
        let mut settings = AppSettings::initial(None);
        let builtin = settings.templates[0].clone();
        assert!(!save_template(&mut settings, builtin.clone()));
        assert!(!delete_template(&mut settings, &builtin.id));
        assert_eq!(settings.templates, vec![builtin]);
    }
    #[test]
    fn deleting_a_template_repairs_references() {
        let mut settings = AppSettings::initial(None);
        let mut template = settings.templates[0].clone();
        template.id = "mine".into();
        template.name = "Mine".into();
        template.builtin = false;
        assert!(save_template(&mut settings, template));
        settings.globals.default_template_id = "mine".into();
        settings.site_rules.push(byoglot_core::SiteRule {
            id: "rule".into(),
            pattern: "example.com".into(),
            template_id: "mine".into(),
        });
        assert!(delete_template(&mut settings, "mine"));
        assert_eq!(
            settings.site_rules[0].template_id,
            byoglot_core::contracts::builtin_template().id
        );
        assert_eq!(
            settings.globals.default_template_id,
            settings.site_rules[0].template_id
        );
    }
    #[test]
    fn profile_limit_counts_utf16_and_reset_restores_builtin() {
        let mut settings = AppSettings::initial(None);
        let limit = byoglot_core::contracts::limits().max_profile_text;
        assert!(!save_profile(
            &mut settings,
            "generic",
            Some("😀".repeat(limit / 2 + 1))
        ));
        assert!(settings.profile_overrides.is_empty());
        assert!(save_profile(
            &mut settings,
            "generic",
            Some("Plain language".into())
        ));
        assert!(save_profile(&mut settings, "generic", None));
        assert!(settings.profile_overrides.is_empty());
        assert!(!save_profile(&mut settings, "auto", Some("unused".into())));
    }
    #[test]
    fn consent_is_only_requested_for_remote_origins() {
        assert_eq!(
            remote_origin("https://example.com/v1"),
            Some("https://example.com".into())
        );
        for url in [
            "http://127.0.0.1:1234/v1",
            "http://192.168.1.4/v1",
            "http://[::1]/v1",
        ] {
            assert_eq!(remote_origin(url), None);
        }
    }
    #[test]
    fn model_choices_preserve_provider_variant_and_connection() {
        let model = byoglot_core::ModelInfo {
            provider_id: "deepseek".into(),
            id: "model".into(),
            name: "Model".into(),
            variants: vec!["none".into(), "high".into()],
            context_limit: 0.0,
            output_limit: 0.0,
        };
        let choices = model_choices(&[model], "c");
        assert_eq!(choices.len(), 2);
        assert_eq!(choices[1].variant.as_deref(), Some("high"));
        assert_eq!(choices[1].connection_id.as_deref(), Some("c"));
        assert_eq!(choices[1].provider_id, "deepseek");
    }
}

pub fn template_target(template: &Template, current: &str) -> String {
    template
        .settings
        .target_lang
        .clone()
        .unwrap_or_else(|| current.into())
}

pub fn editor_input(
    text: String,
    template_id: Option<String>,
    target: String,
) -> byoglot_core::RunnerInput {
    byoglot_core::RunnerInput {
        text,
        template_id,
        target_lang: Some(target),
        context: String::new(),
        app_name: "ByoGlot".into(),
        limit: byoglot_core::EDITOR_INPUT_LIMIT,
    }
}

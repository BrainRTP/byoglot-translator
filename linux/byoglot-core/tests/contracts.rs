mod common;
use byoglot_core::{contracts::*, *};
use common::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};

#[test]
fn compiled_contract_data_matches_repository() {
    let languages = data("languages");
    assert_eq!(json!(language_codes()), languages["codes"]);
    assert_eq!(auto_source_name(), languages["auto"].as_str().unwrap());
    for (code, name) in languages["names"].as_object().unwrap() {
        assert_eq!(json!(language_name(code)), *name);
    }
    assert_eq!(language_name("pt-BR"), "pt-BR");
    let preset = data("presets");
    assert_eq!(json!(presets()), preset["presets"]);
    assert_eq!(json!(favorite_model()), preset["favoriteModel"]);
    assert_eq!(
        json!(selection_default_effort()),
        preset["selectionDefaultEffort"]
    );
    assert_eq!(json!(limits()), data("limits"));
    assert_eq!(limits().max_chars, 4000);
    assert_eq!(json!(builtin_template()), data("builtin-template"));
    let errors = data("errors");
    assert_eq!(json!(ErrorKind::ALL.map(|k| k.wire())), errors["kinds"]);
    assert_eq!(
        json!(
            ErrorKind::ALL
                .iter()
                .filter(|k| BackendError::new(**k).is_fatal())
                .map(ErrorKind::wire)
                .collect::<Vec<_>>()
        ),
        errors["fatal"]
    );
    let generic = &builtin_profiles()[GENERIC_PROFILE];
    assert!(!generic.is_empty());
    assert_eq!(generic.trim(), generic);
}
#[test]
fn text_prompt_cases() {
    let failures: Vec<_> = fixture::<TextPromptInput, String>("prompt-text")
        .into_iter()
        .filter_map(|case| (build_text_prompt(&case.input) != case.expected).then_some(case.name))
        .collect();
    assert!(failures.is_empty(), "failed cases: {failures:?}");
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileInput {
    language_prompt_enabled: bool,
    language_profile: String,
    target_lang: String,
    builtins: BTreeMap<String, String>,
    overrides: HashMap<String, ProfileOverride>,
}
#[test]
fn language_profile_cases() {
    let failures: Vec<_> = fixture::<ProfileInput, String>("language-profile")
        .into_iter()
        .filter_map(|case| {
            let i = case.input;
            (language_prompt_text(
                i.language_prompt_enabled,
                &i.language_profile,
                &i.target_lang,
                &i.builtins,
                &i.overrides,
            ) != case.expected)
                .then_some(case.name)
        })
        .collect();
    assert!(failures.is_empty(), "failed cases: {failures:?}");
}
#[test]
fn profiles_are_discovered_and_trimmed() {
    let paths = std::fs::read_dir(
        contracts_dir()
            .parent()
            .unwrap()
            .join("lib/translate/profiles"),
    )
    .unwrap();
    let mut expected = BTreeMap::new();
    for path in paths {
        let path = path.unwrap().path();
        if path.extension().is_some_and(|v| v == "md") {
            expected.insert(
                path.file_stem().unwrap().to_str().unwrap().to_owned(),
                std::fs::read_to_string(path).unwrap().trim().to_owned(),
            );
        }
    }
    assert_eq!(builtin_profiles(), &expected);
    assert_eq!(primary_lang("RU_ru"), "ru");
    assert_eq!(
        serde_json::to_value(ProviderPreset::Lmstudio).unwrap(),
        Value::String("lmstudio".into())
    );
}

mod common;
use byoglot_core::*;
use common::*;
use serde_json::{Value, json};

fn sample() -> Value {
    data("samples/export-v1")
}
#[test]
fn sample_decodes_and_round_trips() {
    let value = sample();
    let file = ExportFile::decode(&value.to_string()).unwrap();
    assert_eq!(file, serde_json::from_value::<ExportFile>(value).unwrap());
    assert_eq!(
        ExportFile::decode(&serde_json::to_string(&file).unwrap()).unwrap(),
        file
    );
}
#[test]
fn imports_new_provider_presets() {
    for preset in [ProviderPreset::Openai, ProviderPreset::Mistral] {
        let mut value = sample();
        value["connections"] = json!([{
            "id": "new-provider",
            "preset": preset,
            "name": preset.wire(),
            "baseUrl": contracts::presets()[&preset].base_url,
        }]);
        let file = ExportFile::decode(&value.to_string()).unwrap();
        let base_url = file.connections[0].base_url.clone();
        let state = merge_export(file, AppSettings::initial(None));
        assert_eq!(state.connections[0].preset, preset);
        assert_eq!(state.connections[0].base_url, base_url);
    }
}
#[test]
fn rejects_other_formats_versions_unknown_keys_and_invalid_timestamps() {
    for (field, value) in [
        ("format", json!("other")),
        ("version", json!(2)),
        ("exportedAt", json!("2026-02-30T10:00:00Z")),
        ("exportedAt", json!("not a date")),
        ("extra", json!(true)),
    ] {
        let mut v = sample();
        v[field] = value;
        assert!(ExportFile::decode(&v.to_string()).is_err(), "{field}");
    }
    for path in [
        "connection",
        "model",
        "settings",
        "globals",
        "override",
        "rule",
    ] {
        let mut v = sample();
        match path {
            "connection" => v["connections"][0]["apiKey"] = json!("secret"),
            "model" => v["templates"][1]["settings"]["selectionModel"]["apiKey"] = json!("secret"),
            "settings" => v["templates"][0]["settings"]["extra"] = json!(true),
            "globals" => v["globals"]["extra"] = json!(true),
            "override" => v["profileOverrides"]["ru"]["extra"] = json!(true),
            _ => v["siteRules"][0]["extra"] = json!(true),
        }
        assert!(ExportFile::decode(&v.to_string()).is_err(), "{path}");
    }
}
#[test]
fn export_connection_contains_exactly_portable_fields() {
    let file = export_settings(&settings(), "2026-11-12T10:00:00.000Z");
    assert_eq!(
        json!(file.connections[0]),
        json!({"id":"c1", "preset":"deepseek", "name":"DeepSeek", "baseUrl":"https://api.deepseek.com"})
    );
    assert!(ExportFile::decode(&serde_json::to_string(&file).unwrap()).is_ok());
}
#[test]
fn merge_drops_models_of_unknown_connections_and_preserves_known_connections() {
    let mut file = ExportFile::decode(&sample().to_string()).unwrap();
    file.templates[1]
        .settings
        .selection_model
        .as_mut()
        .unwrap()
        .connection_id = Some("absent".into());
    file.connections[0].base_url = "https://changed.example".into();
    let merged = merge_export(file, settings());
    assert!(merged.templates[1].settings.selection_model.is_none());
    assert_eq!(merged.connections[0].base_url, connection().base_url);
}
#[test]
fn merge_replaces_by_id_keeps_one_builtin_and_adds_connections() {
    let mut file = ExportFile::decode(&sample().to_string()).unwrap();
    file.templates.push(file.templates[0].clone());
    let merged = merge_export(file.clone(), AppSettings::initial(None));
    let again = merge_export(file, merged.clone());
    assert_eq!(again, merged);
    assert_eq!(
        again
            .templates
            .iter()
            .filter(|t| t.id == contracts::builtin_template().id)
            .count(),
        1
    );
    assert_eq!(again.connections.len(), 1);
    assert_eq!(
        again.profile_overrides["ru"].text,
        "Keep technical terms clear."
    );
    assert_eq!(again.globals.target_lang, "ru");
}
#[test]
fn initial_models_prefer_favorite_and_fall_back_to_default() {
    let favorite = ModelInfo {
        provider_id: "deepseek".into(),
        id: "deepseek-flash".into(),
        name: "Flash".into(),
        variants: vec!["none".into(), "high".into()],
        context_limit: 0.0,
        output_limit: 0.0,
    };
    let other = ModelInfo {
        id: "other".into(),
        variants: vec!["low".into()],
        ..favorite.clone()
    };
    let (page, selection) =
        pick_initial_models(&[other.clone(), favorite.clone()], Some(&other), "c1");
    assert_eq!(page.unwrap().variant.as_deref(), Some("none"));
    assert_eq!(selection.unwrap(), model());
    let (page, selection) = pick_initial_models(std::slice::from_ref(&other), Some(&other), "c2");
    assert_eq!(page, selection);
    assert_eq!(page.unwrap().variant.as_deref(), Some("low"));
    assert_eq!(pick_initial_models(&[], None, "c1"), (None, None));
}

#[test]
fn merge_skips_invalid_and_insecure_remote_connections() {
    let mut file = ExportFile::decode(&sample().to_string()).unwrap();
    let base = file.connections[0].clone();
    file.connections.clear();
    for (id, base_url) in [
        ("invalid", "broken url"),
        ("insecure", "http://evil.example/v1"),
        ("secure", "https://evil.example/v1"),
        ("lan", "http://192.168.1.1/v1"),
        ("ula", "http://[fd00::1]/v1"),
        ("link", "http://[fe80::1]/v1"),
    ] {
        file.connections.push(ExportConnection {
            id: id.into(),
            base_url: base_url.into(),
            ..base.clone()
        });
    }
    let merged = merge_export(file, AppSettings::initial(None));
    assert_eq!(
        merged
            .connections
            .iter()
            .map(|c| c.id.as_str())
            .collect::<Vec<_>>(),
        ["secure", "lan", "ula", "link"]
    );
}
#[test]
fn override_exports_have_stable_key_order() {
    let mut first = ExportFile::decode(&sample().to_string()).unwrap();
    let mut second = first.clone();
    first.profile_overrides.clear();
    second.profile_overrides.clear();
    let rule = ProfileOverride {
        text: "text".into(),
        base: "base".into(),
        saved_at: 0.0,
    };
    for key in ["ru", "de", "generic"] {
        first.profile_overrides.insert(key.into(), rule.clone());
    }
    for key in ["generic", "de", "ru"] {
        second.profile_overrides.insert(key.into(), rule.clone());
    }
    let serialized = serde_json::to_string(&first).unwrap();
    assert_eq!(serialized, serde_json::to_string(&second).unwrap());
    assert!(serialized.find("\"de\":").unwrap() < serialized.find("\"ru\":").unwrap());
}

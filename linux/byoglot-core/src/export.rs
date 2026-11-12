use crate::{
    AppSettings, Connection, ExportConnection, PortableGlobals, ProfileOverride, SiteRule,
    Template, contracts,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportFile {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub globals: PortableGlobals,
    pub templates: Vec<Template>,
    #[serde(serialize_with = "sorted_overrides")]
    pub profile_overrides: HashMap<String, ProfileOverride>,
    pub site_rules: Vec<SiteRule>,
    pub connections: Vec<ExportConnection>,
}
fn sorted_overrides<S: serde::Serializer>(
    overrides: &HashMap<String, ProfileOverride>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    overrides
        .iter()
        .collect::<std::collections::BTreeMap<_, _>>()
        .serialize(serializer)
}
#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("invalid export JSON")]
    Json(#[from] serde_json::Error),
    #[error("unsupported export format or version")]
    Format,
    #[error("invalid export timestamp")]
    Timestamp,
}
impl ExportFile {
    pub fn decode(json: &str) -> Result<Self, ExportError> {
        let value: serde_json::Value = serde_json::from_str(json)?;
        fn contains_null(value: &serde_json::Value) -> bool {
            match value {
                serde_json::Value::Null => true,
                serde_json::Value::Array(values) => values.iter().any(contains_null),
                serde_json::Value::Object(values) => values.values().any(contains_null),
                _ => false,
            }
        }
        if contains_null(&value) {
            return Err(ExportError::Format);
        }
        let file: Self = serde_json::from_str(json)?;
        if file.format != "byoglot-export" || file.version != 1 {
            return Err(ExportError::Format);
        }
        if !valid_timestamp(&file.exported_at) {
            return Err(ExportError::Timestamp);
        }
        Ok(file)
    }
}
fn valid_timestamp(value: &str) -> bool {
    use crate::provider::{calendar_days, digits};
    let valid = || -> Option<()> {
        if value.get(4..5)? != "-"
            || value.get(7..8)? != "-"
            || value.get(10..11)? != "T"
            || value.get(13..14)? != ":"
            || value.get(16..17)? != ":"
        {
            return None;
        }
        calendar_days(
            digits(value.get(..4)?)? as i32,
            digits(value.get(5..7)?)?,
            digits(value.get(8..10)?)?,
        )?;
        if digits(value.get(11..13)?)? > 23
            || digits(value.get(14..16)?)? > 59
            || digits(value.get(17..19)?)? > 59
        {
            return None;
        }
        let suffix = value.get(19..)?.strip_suffix('Z')?;
        if !suffix.is_empty()
            && !suffix
                .strip_prefix('.')
                .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        {
            return None;
        }
        Some(())
    };
    valid().is_some()
}
pub fn export_settings(s: &AppSettings, now_iso: &str) -> ExportFile {
    ExportFile {
        format: "byoglot-export".into(),
        version: 1,
        exported_at: now_iso.into(),
        globals: s.globals.clone(),
        templates: s.templates.clone(),
        profile_overrides: s.profile_overrides.clone(),
        site_rules: s.site_rules.clone(),
        connections: s
            .connections
            .iter()
            .map(|c| ExportConnection {
                id: c.id.clone(),
                preset: c.preset,
                name: c.name.clone(),
                base_url: c.base_url.clone(),
            })
            .collect(),
    }
}
pub fn merge_export(file: ExportFile, mut into: AppSettings) -> AppSettings {
    into.globals = file.globals;
    for template in file.templates {
        if let Some(existing) = into.templates.iter_mut().find(|t| t.id == template.id) {
            *existing = template;
        } else {
            into.templates.push(template);
        }
    }
    let mut seen = std::collections::HashSet::new();
    into.templates.retain(|t| seen.insert(t.id.clone()));
    if !into
        .templates
        .iter()
        .any(|t| t.id == contracts::builtin_template().id)
    {
        into.templates
            .insert(0, contracts::builtin_template().clone());
    }
    into.profile_overrides.extend(file.profile_overrides);
    for rule in file.site_rules {
        if let Some(existing) = into.site_rules.iter_mut().find(|r| r.id == rule.id) {
            *existing = rule;
        } else {
            into.site_rules.push(rule);
        }
    }
    for connection in file.connections {
        if crate::effort::permitted_endpoint(&connection.base_url).is_some()
            && !into.connections.iter().any(|c| c.id == connection.id)
        {
            into.connections.push(Connection {
                id: connection.id,
                preset: connection.preset,
                name: connection.name,
                base_url: connection.base_url,
                page_model: None,
                selection_model: None,
            });
        }
    }
    let ids: std::collections::HashSet<_> = into.connections.iter().map(|c| c.id.clone()).collect();
    let clean = |model: &mut Option<crate::ModelRef>| {
        if model
            .as_ref()
            .is_some_and(|m| m.connection_id.as_ref().is_none_or(|id| !ids.contains(id)))
        {
            *model = None;
        }
    };
    for template in &mut into.templates {
        clean(&mut template.settings.page_model);
        clean(&mut template.settings.selection_model);
    }
    for connection in &mut into.connections {
        clean(&mut connection.page_model);
        clean(&mut connection.selection_model);
    }
    into
}

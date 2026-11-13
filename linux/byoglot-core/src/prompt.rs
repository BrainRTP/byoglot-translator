use crate::contracts::language_name;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPromptInput {
    pub pre_prompt: String,
    pub language_prompt: String,
    pub source_lang: String,
    pub target_lang: String,
    pub text: String,
    pub context: String,
    pub app_name: String,
}

pub fn build_text_prompt(i: &TextPromptInput) -> String {
    let mut rules = vec!["You are a translation assistant.".to_owned(), format!("A reader selected the TEXT below and wants to understand it. Translate the TEXT from {} to {}.", language_name(&i.source_lang), language_name(&i.target_lang)), "The TEXT can be a single word, a phrase, a sentence or a paragraph. Translate exactly this fragment and keep its form: a term stays a term, a phrase stays a phrase, a sentence stays a sentence. Start with a lowercase letter unless the fragment starts a sentence or is a name.".into()];
    let context = !i.context.trim().is_empty();
    if context {
        rules.push("CONTEXT is the text around the selection. Do not translate it, but use it to pick the meaning that fits, especially for short terms.".into());
    }
    rules.push("The answer is shown to a human as plain text or simple markdown. Do not wrap it in JSON or code fences, do not repeat the source text and do not add notes unless the user instructions ask for them. The user instructions below control wording, style and any extra explanations.".into());
    let mut parts = vec![rules.join("\n")];
    if !i.language_prompt.trim().is_empty() {
        parts.push(format!(
            "LANGUAGE STYLE (the user instructions below override it):\n{}",
            i.language_prompt.trim()
        ));
    }
    parts.push(format!(
        "USER INSTRUCTIONS:\n{}",
        if i.pre_prompt.trim().is_empty() {
            "(none)"
        } else {
            i.pre_prompt.trim()
        }
    ));
    if !i.app_name.trim().is_empty() {
        parts.push(format!(
            "The text comes from the app {}.",
            i.app_name.trim()
        ));
    }
    if context {
        parts.push(format!("CONTEXT (do not translate):\n{}", i.context));
    }
    parts.push(format!("TEXT:\n{}", i.text));
    parts.join("\n\n")
}

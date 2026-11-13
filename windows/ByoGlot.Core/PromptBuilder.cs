namespace ByoGlot.Core;

public sealed record TextPromptInput(string PrePrompt, string LanguagePrompt, string SourceLang, string TargetLang, string Text, string Context, string AppName)
{
    public override string ToString() => "TextPromptInput { [redacted] }";
}

public static class PromptBuilder
{
    public static string Text(TextPromptInput i)
    {
        var rules = new List<string>
        {
            "You are a translation assistant.",
            $"A reader selected the TEXT below and wants to understand it. Translate the TEXT from {Contracts.LanguageName(i.SourceLang)} to {Contracts.LanguageName(i.TargetLang)}.",
            "The TEXT can be a single word, a phrase, a sentence or a paragraph. Translate exactly this fragment and keep its form: a term stays a term, a phrase stays a phrase, a sentence stays a sentence. Start with a lowercase letter unless the fragment starts a sentence or is a name."
        };
        var hasContext = JsText.Trim(i.Context).Length > 0;
        var languagePrompt = JsText.Trim(i.LanguagePrompt);
        var prePrompt = JsText.Trim(i.PrePrompt);
        var appName = JsText.Trim(i.AppName);
        if (hasContext) rules.Add("CONTEXT is the text around the selection. Do not translate it, but use it to pick the meaning that fits, especially for short terms.");
        rules.Add("The answer is shown to a human as plain text or simple markdown. Do not wrap it in JSON or code fences, do not repeat the source text and do not add notes unless the user instructions ask for them. The user instructions below control wording, style and any extra explanations.");
        var parts = new List<string> { string.Join("\n", rules) };
        if (languagePrompt.Length > 0)
            parts.Add("LANGUAGE STYLE (the user instructions below override it):\n" + languagePrompt);
        parts.Add("USER INSTRUCTIONS:\n" + (prePrompt.Length > 0 ? prePrompt : "(none)"));
        if (appName.Length > 0) parts.Add($"The text comes from the app {appName}.");
        if (hasContext) parts.Add("CONTEXT (do not translate):\n" + i.Context);
        parts.Add("TEXT:\n" + i.Text);
        return string.Join("\n\n", parts);
    }
}

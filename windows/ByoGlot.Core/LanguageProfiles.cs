namespace ByoGlot.Core;

public static class LanguageProfiles
{
    public static string PrimaryLang(string code) => code.Split('-', '_')[0].ToLowerInvariant();

    public static string Text(bool enabled, string profile, string targetLang, IReadOnlyDictionary<string, string> builtins, IReadOnlyDictionary<string, ProfileOverride> overrides)
    {
        if (!enabled) return "";
        var language = PrimaryLang(targetLang);
        var own = profile == Contracts.GenericProfile || profile == language;
        var id = own && builtins.ContainsKey(profile) ? profile : builtins.ContainsKey(language) ? language : Contracts.GenericProfile;
        var builtin = builtins.GetValueOrDefault(id, "");
        return overrides.TryGetValue(id, out var value) && value.Text.Trim() != builtin.Trim() ? value.Text : builtin;
    }
}

namespace ByoGlot.Core;

public sealed record AppSettings(PortableGlobals Globals, IReadOnlyList<Template> Templates)
{
    public int SchemaVersion { get; init; } = 1;
    public IReadOnlyDictionary<string, ProfileOverride> ProfileOverrides { get; init; } = new Dictionary<string, ProfileOverride>();
    public IReadOnlyList<SiteRule> SiteRules { get; init; } = [];
    public IReadOnlyList<Connection> Connections { get; init; } = [];
    public string? ActiveConnectionId { get; init; }
    public IReadOnlyList<string> ConsentedOrigins { get; init; } = [];

    public static AppSettings Initial(string? preferredLanguage)
    {
        var primary = LanguageProfiles.PrimaryLang(preferredLanguage ?? "");
        return new(new("auto", Contracts.LanguageCodes.Contains(primary) ? primary : "en", true, "auto", Contracts.BuiltinTemplate.Id), [Contracts.BuiltinTemplate]);
    }
}

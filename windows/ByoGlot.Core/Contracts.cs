using System.Collections.ObjectModel;
using System.Text.Json;

namespace ByoGlot.Core;

public static class Contracts
{
    private static readonly JsonElement Languages = Read("languages.json");
    private static readonly JsonElement PresetData = Read("presets.json");
    public static string AutoSourceName { get; } = Languages.GetProperty("auto").GetString()!;
    public static IReadOnlyList<string> LanguageCodes { get; } = Array.AsReadOnly(Languages.GetProperty("codes").Deserialize<string[]>()!);
    public static string LanguageName(string code) => code == "auto" ? AutoSourceName : Languages.GetProperty("names").TryGetProperty(code, out var name) ? name.GetString()! : code;
    public static IReadOnlyDictionary<ProviderPreset, PresetInfo> Presets { get; } = new ReadOnlyDictionary<ProviderPreset, PresetInfo>(
        PresetData.GetProperty("presets").Deserialize<Dictionary<ProviderPreset, PresetInfo>>(CoreJson.Options)!);
    public static ModelRef FavoriteModel { get; } = PresetData.GetProperty("favoriteModel").Deserialize<ModelRef>(CoreJson.Options)!;
    public static string SelectionDefaultEffort { get; } = PresetData.GetProperty("selectionDefaultEffort").GetString()!;
    public static Limits Limits { get; } = Read("limits.json").Deserialize<Limits>(CoreJson.Options)!;
    public static Template BuiltinTemplate { get; } = Read("builtin-template.json").Deserialize<Template>(CoreJson.Options)!;
    public static IReadOnlyDictionary<string, string> BuiltinProfiles { get; } = ReadProfiles();
    public const string GenericProfile = "generic";

    private static JsonElement Read(string file)
    {
        using var stream = typeof(Contracts).Assembly.GetManifestResourceStream("contracts/" + file)!;
        using var document = JsonDocument.Parse(stream);
        return document.RootElement.Clone();
    }

    private static IReadOnlyDictionary<string, string> ReadProfiles()
    {
        var assembly = typeof(Contracts).Assembly;
        var profiles = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var name in assembly.GetManifestResourceNames().Where(n => n.StartsWith("profiles/", StringComparison.Ordinal)))
        {
            using var reader = new StreamReader(assembly.GetManifestResourceStream(name)!);
            profiles[Path.GetFileNameWithoutExtension(name)] = reader.ReadToEnd().Trim();
        }
        return new ReadOnlyDictionary<string, string>(profiles);
    }
}

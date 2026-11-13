using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ByoGlot.Core;

public static class CoreJson
{
    public static JsonSerializerOptions Options { get; } = new(JsonSerializerDefaults.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true
    };
}

public sealed record ModelRef([property: JsonPropertyName("providerID")] string ProviderID, string Id, string? Variant = null, string? ConnectionId = null);
public sealed record ModelInfo([property: JsonPropertyName("providerID")] string ProviderID, string Id, string Name, IReadOnlyList<string> Variants, double ContextLimit, double OutputLimit);
[JsonConverter(typeof(JsonStringEnumConverter<ProviderPreset>))]
public enum ProviderPreset
{
    [JsonStringEnumMemberName("deepseek")] Deepseek,
    [JsonStringEnumMemberName("openrouter")] Openrouter,
    [JsonStringEnumMemberName("ollama")] Ollama,
    [JsonStringEnumMemberName("lmstudio")] Lmstudio,
    [JsonStringEnumMemberName("custom")] Custom
}
public sealed record Connection(string Id, ProviderPreset Preset, string Name, string BaseUrl, ModelRef? PageModel = null, ModelRef? SelectionModel = null);
[JsonConverter(typeof(JsonStringEnumConverter<DisplayMode>))]
public enum DisplayMode
{
    [JsonStringEnumMemberName("replace")] Replace,
    [JsonStringEnumMemberName("bilingual")] Bilingual
}
public sealed record TemplateSettings(string? PrePrompt = null, string? TargetLang = null, DisplayMode? DisplayMode = null, bool? VisibleOnly = null, ModelRef? PageModel = null, ModelRef? SelectionModel = null)
{
    public override string ToString() => "TemplateSettings { [redacted] }";
}
public sealed record Template(string Id, string Name, bool Builtin, TemplateSettings Settings);
public sealed record ProfileOverride(string Text, string Base, double SavedAt)
{
    public override string ToString() => "ProfileOverride { [redacted] }";
}
public sealed record PortableGlobals(string SourceLang, string TargetLang, bool LanguagePromptEnabled, string LanguageProfile, string DefaultTemplateId);
public sealed record PresetInfo(string BaseUrl, bool NeedsKey);
public sealed record Limits(int MaxBlocks, int MaxChars, int Concurrency, int GenerateTimeoutMs, int MaxProfileText, int MaxEditorText);
public sealed record SiteRule(string Id, string Pattern, string TemplateId);
public sealed record ExportConnection(string Id, ProviderPreset Preset, string Name, string BaseUrl);
public static class InputLimits
{
    public const int Quick = 5000;
    public static int Editor => Contracts.Limits.MaxEditorText;
}

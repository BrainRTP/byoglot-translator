using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace ByoGlot.Core;

public sealed record ExportFile(string Format, int Version, string ExportedAt, PortableGlobals Globals, IReadOnlyList<Template> Templates, IReadOnlyDictionary<string, ProfileOverride> ProfileOverrides, IReadOnlyList<SiteRule> SiteRules, IReadOnlyList<ExportConnection> Connections)
{
    public static ExportFile Decode(string json)
    {
        using var document = JsonDocument.Parse(json);
        ValidateValues(document.RootElement);
        if (document.RootElement.TryGetProperty("connections", out var connections) && connections.ValueKind == JsonValueKind.Array)
            foreach (var connection in connections.EnumerateArray())
                if (connection.ValueKind == JsonValueKind.Object && connection.TryGetProperty("preset", out var preset)
                    && (preset.ValueKind != JsonValueKind.String || preset.GetString() is not ("deepseek" or "openrouter" or "openai" or "mistral" or "ollama" or "lmstudio" or "custom")))
                    throw new JsonException("Unknown provider preset.");
        if (document.RootElement.TryGetProperty("templates", out var templates) && templates.ValueKind == JsonValueKind.Array)
            foreach (var template in templates.EnumerateArray())
                if (template.ValueKind == JsonValueKind.Object && template.TryGetProperty("settings", out var settings) && settings.ValueKind == JsonValueKind.Object
                    && settings.TryGetProperty("displayMode", out var mode) && (mode.ValueKind != JsonValueKind.String || mode.GetString() is not ("replace" or "bilingual")))
                    throw new JsonException("Unknown display mode.");
        var options = new JsonSerializerOptions(CoreJson.Options)
        {
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
            PropertyNameCaseInsensitive = false,
            NumberHandling = JsonNumberHandling.Strict
        };
        var file = JsonSerializer.Deserialize<ExportFile>(json, options) ?? throw new JsonException("Missing export.");
        if (file.Format != "byoglot-export" || file.Version != 1) throw new JsonException("Unsupported export format or version.");
        if (!Regex.IsMatch(file.ExportedAt, @"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$", RegexOptions.CultureInvariant)
            || !DateTimeOffset.TryParse(file.ExportedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out _))
            throw new JsonException("Invalid export timestamp.");
        return file;
    }

    private static void ValidateValues(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Null) throw new JsonException("Null is not part of the export format.");
        if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) ValidateValues(item);
        if (value.ValueKind != JsonValueKind.Object) return;
        foreach (var property in value.EnumerateObject())
        {
            ValidateValues(property.Value);
        }
    }
}

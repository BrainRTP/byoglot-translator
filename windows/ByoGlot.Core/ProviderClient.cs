using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ByoGlot.Core;

public interface ITextGenerator
{
    Task<string> GenerateAsync(string prompt, ModelRef model, CancellationToken ct);
}

public sealed class ProviderClient(Connection connection, string? secret, IHttpTransport transport, Func<DateTimeOffset>? now = null) : ITextGenerator
{
    public async Task<IReadOnlyList<ModelInfo>> ListModelsAsync(CancellationToken ct)
    {
        var root = await CallAsync("/models", null, TimeSpan.FromSeconds(30), ct);
        if (root.ValueKind != JsonValueKind.Object || Field(root, "data").ValueKind != JsonValueKind.Array) throw Shape();
        var models = new List<ModelInfo>();
        foreach (var raw in Field(root, "data").EnumerateArray())
        {
            if (raw.ValueKind != JsonValueKind.Object || !IsString(Field(raw, "id"))) throw Shape();
            ValidateOptional(raw, "name", IsString);
            foreach (var field in new[] { "context_window", "context_length", "max_output_tokens" }) ValidateOptional(raw, field, IsNumber);
            ValidateOptional(raw, "supported_parameters", IsStringArray);
            if (raw.TryGetProperty("effort", out var effort))
            {
                if (effort.ValueKind != JsonValueKind.Object) throw Shape();
                ValidateOptional(effort, "supported_levels", IsStringArray);
            }
            var context = raw.TryGetProperty("context_window", out var window) ? window : Field(raw, "context_length");
            models.Add(new(connection.Preset.ToString().ToLowerInvariant(), Field(raw, "id").GetString()!,
                raw.TryGetProperty("name", out var name) ? name.GetString()! : Field(raw, "id").GetString()!,
                ProviderEffort.Variants(connection.Preset, Strings(Field(effort, "supported_levels")), Strings(Field(raw, "supported_parameters"))),
                Number(context), Number(Field(raw, "max_output_tokens"))));
        }
        return models;
    }

    public async Task<ModelInfo?> DefaultModelAsync(CancellationToken ct)
    {
        var models = await ListModelsAsync(ct);
        return connection.Preset == ProviderPreset.Deepseek ? models.FirstOrDefault(m => m.Id == "deepseek-flash") : models.FirstOrDefault();
    }

    public async Task<string> GenerateAsync(string prompt, ModelRef model, CancellationToken ct)
    {
        var body = ProviderEffort.Params(connection.Preset, model.Variant);
        body["model"] = model.Id;
        body["messages"] = new JsonArray(new JsonObject { ["role"] = "user", ["content"] = prompt });
        body["stream"] = false;
        var root = await CallAsync("/chat/completions", body, TimeSpan.FromMilliseconds(Contracts.Limits.GenerateTimeoutMs), ct);
        if (root.ValueKind != JsonValueKind.Object || Field(root, "choices").ValueKind != JsonValueKind.Array) throw Shape();
        var choices = Field(root, "choices");
        foreach (var choice in choices.EnumerateArray())
        {
            if (choice.ValueKind != JsonValueKind.Object || Field(choice, "message").ValueKind != JsonValueKind.Object) throw Shape();
            var content = Field(Field(choice, "message"), "content");
            if (content.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null) && !IsString(content)) throw Shape();
        }
        var first = choices.GetArrayLength() > 0 ? Field(Field(choices[0], "message"), "content") : default;
        var text = first.ValueKind == JsonValueKind.String ? first.GetString() : null;
        return string.IsNullOrEmpty(text) ? throw new BackendException(ErrorKind.BadResponse, detail: "empty completion") : text;
    }

    private async Task<JsonElement> CallAsync(string path, JsonObject? body, TimeSpan timeout, CancellationToken ct)
    {
        if (!Origins.IsAllowedEndpoint(connection.BaseUrl)) throw new BackendException(ErrorKind.Offline);
        var headers = new Dictionary<string, string>();
        if (!string.IsNullOrEmpty(secret)) headers["authorization"] = "Bearer " + secret;
        if (body is not null) headers["content-type"] = "application/json";
        HttpResponseData response;
        try
        {
            response = await transport.SendAsync(new(body is null ? "GET" : "POST", connection.BaseUrl.TrimEnd('/') + path,
                headers, body is null ? null : JsonSerializer.SerializeToUtf8Bytes(body, CoreJson.Options)), timeout, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw new BackendException(ErrorKind.Aborted); }
        catch (TransportException) { throw new BackendException(ErrorKind.Offline); }
        if (response.Status is < 200 or >= 300) throw Failure(response);
        try
        {
            using var document = JsonDocument.Parse(response.Body);
            return document.RootElement.Clone();
        }
        catch (JsonException) { throw new BackendException(ErrorKind.Incompatible, detail: "response is not JSON"); }
    }

    private BackendException Failure(HttpResponseData response)
    {
        string? detail = null;
        try
        {
            using var document = JsonDocument.Parse(response.Body);
            var message = Field(Field(document.RootElement, "error"), "message");
            if (IsString(message)) detail = message.GetString();
        }
        catch (JsonException) { }
        return response.Status switch
        {
            401 or 403 => new(ErrorKind.ProviderAuth, response.Status, detail: detail),
            404 => new(ErrorKind.Incompatible, detail: "HTTP 404"),
            402 => new(ErrorKind.ProviderError, response.Status, detail: "insufficient balance"),
            429 => new(ErrorKind.RateLimit, response.Status, RetryAfter(response.Headers.GetValueOrDefault("retry-after")), detail),
            _ => new(ErrorKind.ProviderError, response.Status, detail: detail ?? $"HTTP {response.Status}")
        };
    }

    private long? RetryAfter(string? header)
    {
        var value = header is null ? null : JsText.Trim(header);
        if (string.IsNullOrEmpty(value)) return null;
        if (Regex.IsMatch(value, @"^[0-9]+(?:\.[0-9]+)?$", RegexOptions.CultureInvariant))
        {
            if (!double.TryParse(value, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var seconds)) return null;
            var ms = Math.Round(seconds * 1000, MidpointRounding.AwayFromZero);
            return double.IsFinite(ms) && ms < long.MaxValue ? (long)ms : null;
        }
        if (DateTimeOffset.TryParseExact(value, "r", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)
            && date.ToString("r", CultureInfo.InvariantCulture) == value)
            return Math.Max(0, (long)(date - (now?.Invoke() ?? DateTimeOffset.UtcNow)).TotalMilliseconds);
        return null;
    }

    private static BackendException Shape() => new(ErrorKind.Incompatible, detail: "unexpected response shape");
    private static JsonElement Field(JsonElement obj, string key) => obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(key, out var value) ? value : default;
    private static bool IsString(JsonElement node) => node.ValueKind == JsonValueKind.String;
    private static bool IsNumber(JsonElement node) => node.ValueKind == JsonValueKind.Number && node.TryGetDouble(out var number) && double.IsFinite(number);
    private static bool IsStringArray(JsonElement node) => node.ValueKind == JsonValueKind.Array && node.EnumerateArray().All(IsString);
    private static void ValidateOptional(JsonElement obj, string key, Func<JsonElement, bool> valid)
    {
        if (obj.TryGetProperty(key, out var node) && !valid(node)) throw Shape();
    }
    private static string[]? Strings(JsonElement node) => node.ValueKind == JsonValueKind.Undefined ? null : node.EnumerateArray().Select(n => n.GetString()!).ToArray();
    private static int Number(JsonElement node) => node.ValueKind == JsonValueKind.Undefined ? 0 : (int)Math.Clamp(node.GetDouble(), int.MinValue, int.MaxValue);
}

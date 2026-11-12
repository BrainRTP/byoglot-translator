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
        if (root is not JsonObject || root["data"] is not JsonArray data) throw Shape();
        var models = new List<ModelInfo>();
        foreach (var raw in data)
        {
            if (raw is not JsonObject model || !IsString(model["id"])) throw Shape();
            ValidateOptional(model, "name", IsString);
            foreach (var field in new[] { "context_window", "context_length", "max_output_tokens" }) ValidateOptional(model, field, IsNumber);
            ValidateOptional(model, "supported_parameters", IsStringArray);
            if (model.TryGetPropertyValue("effort", out var effort))
            {
                if (effort is not JsonObject obj) throw Shape();
                ValidateOptional(obj, "supported_levels", IsStringArray);
            }
            models.Add(new(connection.Preset.ToString().ToLowerInvariant(), model["id"]!.GetValue<string>(),
                model["name"]?.GetValue<string>() ?? model["id"]!.GetValue<string>(),
                ProviderEffort.Variants(connection.Preset, Strings(model["effort"]?["supported_levels"]), Strings(model["supported_parameters"])),
                Number(model["context_window"] ?? model["context_length"]), Number(model["max_output_tokens"])));
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
        if (root is not JsonObject || root["choices"] is not JsonArray choices) throw Shape();
        foreach (var choice in choices)
        {
            if (choice is not JsonObject || choice["message"] is not JsonObject message) throw Shape();
            if (message["content"] is { } content && !IsString(content)) throw Shape();
        }
        var text = choices.FirstOrDefault()?["message"]?["content"]?.GetValue<string>();
        return string.IsNullOrEmpty(text) ? throw new BackendException(ErrorKind.BadResponse, detail: "empty completion") : text;
    }

    private async Task<JsonNode?> CallAsync(string path, JsonObject? body, TimeSpan timeout, CancellationToken ct)
    {
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
        try { return JsonNode.Parse(response.Body); }
        catch (JsonException) { throw new BackendException(ErrorKind.Incompatible, detail: "response is not JSON"); }
    }

    private BackendException Failure(HttpResponseData response)
    {
        string? detail = null;
        try
        {
            var root = JsonNode.Parse(response.Body);
            if (root is JsonObject && root["error"] is JsonObject error && IsString(error["message"])) detail = error["message"]!.GetValue<string>();
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
        var value = header?.Trim();
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
    private static bool IsString(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out _);
    private static bool IsNumber(JsonNode? node) => node is JsonValue v && v.TryGetValue<double>(out _);
    private static bool IsStringArray(JsonNode? node) => node is JsonArray array && array.All(IsString);
    private static void ValidateOptional(JsonObject obj, string key, Func<JsonNode?, bool> valid)
    {
        if (obj.TryGetPropertyValue(key, out var node) && !valid(node)) throw Shape();
    }
    private static string[]? Strings(JsonNode? node) => node?.AsArray().Select(n => n!.GetValue<string>()).ToArray();
    private static int Number(JsonNode? node) => node is null ? 0 : checked((int)node.GetValue<double>());
}

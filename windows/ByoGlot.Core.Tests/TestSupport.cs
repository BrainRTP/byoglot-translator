using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ByoGlot.Core.Tests;

internal static class TestJson
{
    public static IEnumerable<object[]> Cases(string contract) => ContractsFolder.Fixture<JsonElement, JsonElement>(contract)
        .Select(c => new object[] { c.Name, c.Input.GetRawText(), c.Expected.GetRawText() });
    public static T Read<T>(string json) => JsonSerializer.Deserialize<T>(json, CoreJson.Options)!;
    public static void Equal(JsonNode? expected, object? actual) => Assert.True(JsonNode.DeepEquals(expected, JsonSerializer.SerializeToNode(actual, CoreJson.Options)), $"Expected {expected}, got {JsonSerializer.Serialize(actual, CoreJson.Options)}");
    public static JsonObject Error(BackendException e)
    {
        var error = new JsonObject { ["kind"] = e.Kind.Wire() };
        if (e.Status is { } status) error["status"] = status;
        if (e.RetryAfterMs is { } retry) error["retryAfterMs"] = retry;
        if (e.Detail is { } detail) error["detail"] = detail;
        return error;
    }
}

internal sealed class RecordingTransport(HttpResponseData? response = null) : IHttpTransport
{
    public List<(HttpRequestData Request, TimeSpan Timeout)> Calls { get; } = [];
    public HttpResponseData Response { get; set; } = response ?? JsonResponse("{\"choices\":[{\"message\":{\"content\":\" translated \"}}]}");
    public Func<HttpRequestData, CancellationToken, Task<HttpResponseData>>? Handler { get; init; }
    public Task<HttpResponseData> SendAsync(HttpRequestData request, TimeSpan timeout, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        Calls.Add((request, timeout));
        return Handler?.Invoke(request, ct) ?? Task.FromResult(Response);
    }
    public static HttpResponseData JsonResponse(string body, int status = 200) => new(status, new Dictionary<string, string>(), Encoding.UTF8.GetBytes(body));
    public static RecordingTransport FromFixture(JsonNode response)
    {
        var headers = response["headers"]!.Deserialize<Dictionary<string, string>>()!.ToDictionary(p => p.Key.ToLowerInvariant(), p => p.Value);
        var body = response["body"]!;
        return new(new(response["status"]!.GetValue<int>(), headers, Encoding.UTF8.GetBytes(body is JsonValue value && value.TryGetValue<string>(out var text) ? text : body.ToJsonString())));
    }
}

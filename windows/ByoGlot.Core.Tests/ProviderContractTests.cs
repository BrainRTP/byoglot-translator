using System.Text.Json.Nodes;

namespace ByoGlot.Core.Tests;

public class ProviderContractTests
{
    public static IEnumerable<object[]> ModelCases => TestJson.Cases("provider-models");
    public static IEnumerable<object[]> ChatCases => TestJson.Cases("provider-chat");
    public static IEnumerable<object[]> ErrorCases => TestJson.Cases("provider-errors");
    public static IEnumerable<object[]> EffortCases => TestJson.Cases("provider-effort");

    private static ProviderClient Client(JsonNode input, RecordingTransport transport)
    {
        var p = input["provider"]!;
        return new(new("fixture", TestJson.Read<ProviderPreset>(p["preset"]!.ToJsonString()), p["name"]!.GetValue<string>(), p["baseUrl"]!.GetValue<string>()),
            p["apiKey"]!.GetValue<string>(), transport, input["now"] is { } now ? () => DateTimeOffset.Parse(now.GetValue<string>(), System.Globalization.CultureInfo.InvariantCulture) : null);
    }

    private static void Request(JsonNode expected, RecordingTransport transport, int timeout)
    {
        var call = transport.Calls[0];
        Assert.Equal(expected["method"]!.GetValue<string>(), call.Request.Method);
        Assert.Equal(expected["url"]!.GetValue<string>(), call.Request.Url);
        TestJson.Equal(expected["headers"], call.Request.Headers);
        Assert.True(JsonNode.DeepEquals(expected["body"], call.Request.Body is null ? null : JsonNode.Parse(call.Request.Body)));
        Assert.Equal(TimeSpan.FromMilliseconds(timeout), call.Timeout);
    }

    [Theory, MemberData(nameof(ModelCases))]
    public async Task ModelsMatchEveryFixture(string name, string inputJson, string expectedJson)
    {
        _ = name;
        var input = JsonNode.Parse(inputJson)!;
        var expected = JsonNode.Parse(expectedJson)!;
        var transport = RecordingTransport.FromFixture(input["response"]!);
        var client = Client(input, transport);
        TestJson.Equal(expected["models"], await client.ListModelsAsync(CancellationToken.None));
        TestJson.Equal(expected["defaultModel"], await client.DefaultModelAsync(CancellationToken.None));
        Request(expected["request"]!, transport, 30000);
    }

    [Theory, MemberData(nameof(ChatCases))]
    public async Task ChatMatchesEveryFixture(string name, string inputJson, string expectedJson)
    {
        _ = name;
        var input = JsonNode.Parse(inputJson)!;
        var expected = JsonNode.Parse(expectedJson)!;
        var transport = RecordingTransport.FromFixture(input["response"]!);
        var client = Client(input, transport);
        async Task<string> Generate() => await client.GenerateAsync(input["prompt"]!.GetValue<string>(), TestJson.Read<ModelRef>(input["model"]!.ToJsonString()), CancellationToken.None);
        if (expected["result"]!["error"] is { } error)
            Assert.True(JsonNode.DeepEquals(error, TestJson.Error(await Assert.ThrowsAsync<BackendException>(Generate))));
        else Assert.Equal(expected["result"]!["content"]!.GetValue<string>(), await Generate());
        Request(expected["request"]!, transport, Contracts.Limits.GenerateTimeoutMs);
    }

    [Theory, MemberData(nameof(ErrorCases))]
    public async Task ErrorsMatchEveryFixture(string name, string inputJson, string expectedJson)
    {
        _ = name;
        var input = JsonNode.Parse(inputJson)!;
        var transport = RecordingTransport.FromFixture(input["response"]!);
        var error = await Assert.ThrowsAsync<BackendException>(() => Client(input, transport).ListModelsAsync(CancellationToken.None));
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(expectedJson), TestJson.Error(error)), TestJson.Error(error).ToJsonString());
    }

    [Theory, MemberData(nameof(EffortCases))]
    public void EffortMatchesEveryFixture(string name, string inputJson, string expectedJson)
    {
        _ = name;
        var input = JsonNode.Parse(inputJson)!;
        var expected = JsonNode.Parse(expectedJson)!;
        var preset = TestJson.Read<ProviderPreset>(input["preset"]!.ToJsonString());
        string[]? Strings(JsonNode? n) => n is null ? null : TestJson.Read<string[]>(n.ToJsonString());
        TestJson.Equal(expected["variants"], ProviderEffort.Variants(preset, Strings(input["rawModel"]?["effort"]?["supported_levels"]), Strings(input["rawModel"]?["supported_parameters"])));
        Assert.True(JsonNode.DeepEquals(expected["params"], ProviderEffort.Params(preset, input["variant"]?.GetValue<string>())));
        Assert.Equal(expected["needsKey"]!.GetValue<bool>(), ProviderEffort.NeedsKey(preset, input["baseUrl"]!.GetValue<string>()));
    }

    [Theory]
    [InlineData("{\"data\":[{\"id\":false}]}")]
    [InlineData("{\"data\":[{\"id\":\"m\",\"effort\":null}]}")]
    [InlineData("{\"data\":[{\"id\":\"m\",\"supported_parameters\":[1]}]}")]
    public async Task InvalidModelMetadataIsIncompatible(string body)
    {
        var client = new ProviderClient(new("c", ProviderPreset.Custom, "", "http://localhost"), null, new RecordingTransport(RecordingTransport.JsonResponse(body)));
        var error = await Assert.ThrowsAsync<BackendException>(() => client.ListModelsAsync(CancellationToken.None));
        Assert.Equal(ErrorKind.Incompatible, error.Kind);
        Assert.Equal("unexpected response shape", error.Detail);
    }

    [Theory]
    [InlineData(TransportFailure.Offline)]
    [InlineData(TransportFailure.Timeout)]
    public async Task TransportFailuresAreOffline(TransportFailure failure)
    {
        var transport = new RecordingTransport { Handler = (_, _) => throw new TransportException(failure) };
        var client = new ProviderClient(new("c", ProviderPreset.Custom, "", "http://localhost"), null, transport);
        Assert.Equal(ErrorKind.Offline, (await Assert.ThrowsAsync<BackendException>(() => client.ListModelsAsync(CancellationToken.None))).Kind);
    }
}

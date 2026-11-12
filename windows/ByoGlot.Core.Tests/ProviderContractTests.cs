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
    [InlineData("{\"data\":[{\"id\":\"m\",\"context_length\":1e400}]}")]
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
    [Fact]
    public async Task DuplicateChatKeysUseTheLastValue()
    {
        var transport = new RecordingTransport(RecordingTransport.JsonResponse("""{"choices":[],"choices":[{"message":{"content":"first","content":"last"}}]}"""));
        var client = new ProviderClient(new("c", ProviderPreset.Custom, "", "http://localhost"), null, transport);
        Assert.Equal("last", await client.GenerateAsync("prompt", new("custom", "m"), CancellationToken.None));
    }

    [Fact]
    public async Task DuplicateErrorKeysUseTheLastMessage()
    {
        var transport = new RecordingTransport(RecordingTransport.JsonResponse("""{"error":{},"error":{"message":"first","message":"last"}}""", 500));
        var client = new ProviderClient(new("c", ProviderPreset.Custom, "", "http://localhost"), null, transport);
        var error = await Assert.ThrowsAsync<BackendException>(() => client.ListModelsAsync(CancellationToken.None));
        Assert.Equal(ErrorKind.ProviderError, error.Kind);
        Assert.Equal("last", error.Detail);
    }

    [Fact]
    public async Task DuplicateModelKeysAndLargeTokenCountsAreHandled()
    {
        var transport = new RecordingTransport(RecordingTransport.JsonResponse("""{"data":[{"id":"first","id":"last","context_length":3000000000,"max_output_tokens":3000000000}]}"""));
        var client = new ProviderClient(new("c", ProviderPreset.Custom, "", "http://localhost"), null, transport);
        var model = Assert.Single(await client.ListModelsAsync(CancellationToken.None));
        Assert.Equal("last", model.Id);
        Assert.Equal(int.MaxValue, model.ContextLimit);
        Assert.Equal(int.MaxValue, model.OutputLimit);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PublicCleartextIsRejectedBeforeTransport(bool generate)
    {
        var transport = new RecordingTransport();
        var client = new ProviderClient(new("c", ProviderPreset.Ollama, "", "http://models.example.com/v1"), null, transport);
        var error = generate
            ? await Assert.ThrowsAsync<BackendException>(() => client.GenerateAsync("private text", new("ollama", "m"), CancellationToken.None))
            : await Assert.ThrowsAsync<BackendException>(() => client.ListModelsAsync(CancellationToken.None));
        Assert.Equal(ErrorKind.Offline, error.Kind);
        Assert.Empty(transport.Calls);
    }

    [Theory]
    [InlineData("http://localhost:8080/v1", false)]
    [InlineData("http://127.0.0.1:8080/v1", false)]
    [InlineData("http://127.0.0.2:8080/v1", true)]
    [InlineData("http://192.168.1.5:8080/v1", true)]
    [InlineData("http://[::1]:8080/v1", true)]
    [InlineData("http://model.local:8080/v1", true)]
    public void CustomKeyExemptionMatchesTypeScript(string url, bool expected) => Assert.Equal(expected, ProviderEffort.NeedsKey(ProviderPreset.Custom, url));

    [Fact]
    public async Task ChatBodyKeepsUnicodeAndPlainTextUnescaped()
    {
        var transport = new RecordingTransport();
        var client = new ProviderClient(new("c", ProviderPreset.Custom, "", "http://localhost"), null, transport);
        await client.GenerateAsync("Привет <>&'", new("custom", "m"), CancellationToken.None);
        var body = System.Text.Encoding.UTF8.GetString(Assert.Single(transport.Calls).Request.Body!);
        Assert.Contains("Привет <>&'", body);
    }

}

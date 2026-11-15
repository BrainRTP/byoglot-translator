using System.Text;
using ByoGlot.App.ViewModels;

namespace ByoGlot.App.Tests;

public sealed class MainViewModelTests
{
    private static MainViewModel Model(IHttpTransport transport)
    {
        var model = new ModelRef("custom", "model", ConnectionId: "c");
        var settings = new InMemorySettingsRepository(AppSettings.Initial("en") with
        {
            Connections = [new("c", ProviderPreset.Custom, "Local", "http://localhost:11434/v1", model, model)],
            ActiveConnectionId = "c"
        });
        return new(new(new(settings, new InMemorySecretStore(), transport), settings));
    }

    [Fact] public async Task UnchangedTextPreservesTheRequestAndCompletedResult()
    {
        var transport = new PendingTransport();
        var model = Model(transport);
        model.Text = "hello";
        var pending = model.State.TranslateAsync(model.Text, null);
        var working = Assert.IsType<TranslatePhase.Working>(model.State.Phase);
        model.Text = new string("hello".ToCharArray());
        Assert.Same(working, model.State.Phase);
        Assert.False(transport.Cancellation.IsCancellationRequested);
        transport.Completion.SetResult(new(200, new Dictionary<string, string>(), Encoding.UTF8.GetBytes("{\"choices\":[{\"message\":{\"content\":\"result\"}}]}")));
        await pending;
        var done = Assert.IsType<TranslatePhase.Done>(model.State.Phase);
        model.Text = "hello";
        Assert.Same(done, model.State.Phase);
        Assert.Equal("result", done.Output.Text);
        Assert.Equal(1, transport.Calls);
        model.Text = "changed";
        Assert.IsType<TranslatePhase.Idle>(model.State.Phase);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task EditingTextClearsThePreviousValidationError(bool tooLong)
    {
        var model = Model(new PendingTransport());
        model.Text = tooLong ? new string('a', InputLimits.Editor + 1) : "";
        await model.State.TranslateAsync(model.Text, null);
        var failed = Assert.IsType<TranslatePhase.Failed>(model.State.Phase);
        if (tooLong) Assert.IsType<RunnerError.TooLong>(failed.Error);
        else Assert.IsType<RunnerError.Empty>(failed.Error);
        model.Text = "valid";
        Assert.IsType<TranslatePhase.Idle>(model.State.Phase);
    }

    private sealed class PendingTransport : IHttpTransport
    {
        public TaskCompletionSource<HttpResponseData> Completion { get; } = new();
        public CancellationToken Cancellation { get; private set; }
        public int Calls { get; private set; }
        public Task<HttpResponseData> SendAsync(HttpRequestData request, TimeSpan timeout, CancellationToken ct)
        {
            Cancellation = ct;
            Calls++;
            return Completion.Task;
        }
    }
}

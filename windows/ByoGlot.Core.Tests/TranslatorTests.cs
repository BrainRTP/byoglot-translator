namespace ByoGlot.Core.Tests;

public class TranslatorTests
{
    private sealed class Generator(Func<string, CancellationToken, Task<string>> generate) : ITextGenerator
    {
        public Task<string> GenerateAsync(string prompt, ModelRef model, CancellationToken ct) => generate(prompt, ct);
    }
    private static TextRequest Request(string text = "hello") => new(text, "", "", "en", "ru", "", "", new("deepseek", "deepseek-flash"));
    private static Translator Translator(Generator g, int limit = 200) => new(_ => Task.FromResult<ITextGenerator>(g), limit);

    [Fact]
    public async Task TrimsAnswerUsesContractPromptAndCachesIdenticalRequests()
    {
        var calls = 0;
        var fixture = ContractsFolder.Fixture<TextPromptInput, string>("prompt-text").First();
        var i = fixture.Input;
        var request = new TextRequest(i.Text, i.Context, i.AppName, i.SourceLang, i.TargetLang, i.PrePrompt, i.LanguagePrompt, Request().Model);
        var translator = Translator(new((prompt, _) => { calls++; Assert.Equal(fixture.Expected, prompt); return Task.FromResult(" answer \n"); }));
        Assert.Equal("answer", await translator.TranslateAsync(request, CancellationToken.None));
        Assert.Equal("answer", await translator.TranslateAsync(request, CancellationToken.None));
        Assert.Equal(1, calls);
        translator.ClearCache();
        await translator.TranslateAsync(request, CancellationToken.None);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task FailureIsNotCached()
    {
        var calls = 0;
        var translator = Translator(new((_, _) => ++calls == 1 ? throw new BackendException(ErrorKind.Offline) : Task.FromResult("ok")));
        await Assert.ThrowsAsync<BackendException>(() => translator.TranslateAsync(Request(), CancellationToken.None));
        Assert.Equal("ok", await translator.TranslateAsync(Request(), CancellationToken.None));
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task TenConcurrentRequestsPeakAtFour()
    {
        var active = 0;
        var peak = 0;
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var translator = Translator(new(async (_, ct) =>
        {
            var current = Interlocked.Increment(ref active);
            InterlockedExtensions.Max(ref peak, current);
            if (current == 4) ready.TrySetResult();
            try { await release.Task.WaitAsync(ct); return "ok"; }
            finally { Interlocked.Decrement(ref active); }
        }));
        var tasks = Enumerable.Range(0, 10).Select(n => translator.TranslateAsync(Request(n.ToString(System.Globalization.CultureInfo.InvariantCulture)), CancellationToken.None)).ToArray();
        await ready.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        release.SetResult();
        await Task.WhenAll(tasks);
        Assert.Equal(4, peak);
    }

    [Fact]
    public async Task CancellationThrowsOperationCanceled()
    {
        using var cts = new CancellationTokenSource();
        var translator = Translator(new(async (_, ct) => { cts.Cancel(); await Task.Delay(Timeout.Infinite, ct); return ""; }));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => translator.TranslateAsync(Request(), cts.Token));
    }

    [Fact]
    public async Task CacheEvictsAtItsLimit()
    {
        var calls = 0;
        var translator = Translator(new((_, _) => { calls++; return Task.FromResult("ok"); }), 1);
        await translator.TranslateAsync(Request("a"), CancellationToken.None);
        await translator.TranslateAsync(Request("b"), CancellationToken.None);
        await translator.TranslateAsync(Request("a"), CancellationToken.None);
        Assert.Equal(3, calls);
    }
    [Theory]
    [InlineData("\uFEFFanswer\uFEFF", "answer")]
    [InlineData("\u0085answer\u0085", "\u0085answer\u0085")]
    public async Task AnswerTrimmingMatchesJavaScript(string answer, string expected)
    {
        var translator = Translator(new((_, _) => Task.FromResult(answer)));
        Assert.Equal(expected, await translator.TranslateAsync(Request(), CancellationToken.None));
    }

}

internal static class InterlockedExtensions
{
    public static void Max(ref int location, int value)
    {
        int current;
        do { current = Volatile.Read(ref location); if (current >= value) return; }
        while (Interlocked.CompareExchange(ref location, value, current) != current);
    }
}

namespace ByoGlot.Core;

public sealed record TextRequest(string Text, string Context, string AppName, string SourceLang, string TargetLang, string PrePrompt, string LanguagePrompt, ModelRef Model);

public sealed class Translator(Func<CancellationToken, Task<ITextGenerator>> generator, int cacheLimit = 200)
{
    private readonly SemaphoreSlim slots = new(Contracts.Limits.Concurrency);
    private readonly Dictionary<TextRequest, string> cache = [];
    private readonly Queue<TextRequest> order = [];
    private readonly object gate = new();
    private int generation;

    public async Task<string> TranslateAsync(TextRequest request, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        lock (gate) if (cache.TryGetValue(request, out var cached)) return cached;
        await slots.WaitAsync(ct);
        try
        {
            int currentGeneration;
            lock (gate)
            {
                if (cache.TryGetValue(request, out var cached)) return cached;
                currentGeneration = generation;
            }
            var backend = await generator(ct);
            var prompt = PromptBuilder.Text(new(request.PrePrompt, request.LanguagePrompt, request.SourceLang, request.TargetLang, request.Text, request.Context, request.AppName));
            var result = JsText.Trim(await backend.GenerateAsync(prompt, request.Model, ct));
            ct.ThrowIfCancellationRequested();
            lock (gate)
            {
                if (cacheLimit > 0 && generation == currentGeneration && !cache.ContainsKey(request))
                {
                    while (cache.Count >= cacheLimit) cache.Remove(order.Dequeue());
                    cache[request] = result;
                    order.Enqueue(request);
                }
            }
            return result;
        }
        finally { slots.Release(); }
    }

    public void ClearCache()
    {
        lock (gate)
        {
            cache.Clear();
            order.Clear();
            generation++;
        }
    }
}

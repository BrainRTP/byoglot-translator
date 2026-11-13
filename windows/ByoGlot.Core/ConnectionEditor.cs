namespace ByoGlot.Core;

public sealed record ConnectionDraft(string? Id, ProviderPreset Preset, string Name, string BaseUrl, string ApiKey)
{
    public override string ToString() => $"ConnectionDraft {{ Id = {Id}, Preset = {Preset}, ApiKey = [redacted] }}";
}
public enum DraftProblem { BaseUrl, ApiKey, InsecureRemote }

public sealed class ConnectionEditor(ISettingsRepository settings, ISecretStore secrets, IHttpTransport transport)
{
    private readonly SemaphoreSlim saveGate = new(1, 1);

    public DraftProblem? Validate(ConnectionDraft draft, bool hasStoredKey)
    {
        if (Origins.OriginOf(draft.BaseUrl) is not { } origin) return DraftProblem.BaseUrl;
        var uri = new Uri(origin);
        if (uri.Scheme == "http" && !Origins.IsLocalHost(uri.Host)) return DraftProblem.InsecureRemote;
        return ProviderEffort.NeedsKey(draft.Preset, draft.BaseUrl) && JsText.Trim(draft.ApiKey).Length == 0 && !hasStoredKey ? DraftProblem.ApiKey : null;
    }

    public async Task<Connection> SaveAsync(ConnectionDraft draft, bool consent, CancellationToken ct)
    {
        await saveGate.WaitAsync(ct);
        try { return await SaveCoreAsync(draft, consent, ct); }
        finally { saveGate.Release(); }
    }

    private async Task<Connection> SaveCoreAsync(ConnectionDraft draft, bool consent, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var origin = Origins.OriginOf(draft.BaseUrl) ?? throw new ArgumentException(nameof(DraftProblem.BaseUrl));
        var state = await settings.ReadAsync();
        var old = state.Connections.FirstOrDefault(c => c.Id == draft.Id);
        var changedOrigin = old is not null && Origins.OriginOf(old.BaseUrl) != origin;
        var hasKey = old is not null && !changedOrigin && await secrets.HasAsync(old.Id);
        if (Validate(draft, hasKey) is { } problem) throw new ArgumentException(problem.ToString());
        if (!Origins.IsLocalHost(new Uri(origin).Host) && !consent && !state.ConsentedOrigins.Contains(origin))
            throw new RunnerException(new RunnerError.ConsentNeeded(origin));
        var id = old?.Id ?? draft.Id ?? Guid.NewGuid().ToString();
        string? key = JsText.Trim(draft.ApiKey);
        if (key.Length == 0 && hasKey)
        {
            try { key = await secrets.GetAsync(id, origin); }
            catch (OriginMismatchException) { throw new RunnerException(new RunnerError.KeyMissing()); }
        }
        var connection = new Connection(id, draft.Preset, JsText.Trim(draft.Name), Origins.NormalizeBaseUrl(draft.BaseUrl)!);
        var client = new ProviderClient(connection, key, transport);
        var (models, defaultModel) = await ModelsWithDefaultAsync(client, ct);
        var initial = SettingsLogic.PickInitialModels(models, defaultModel, id);
        connection = connection with { PageModel = initial.Page, SelectionModel = initial.Selection };
        ct.ThrowIfCancellationRequested();
        var oldOrigin = old is null ? null : Origins.OriginOf(old.BaseUrl);
        string? oldKey = null;
        if (oldOrigin is not null)
        {
            try { oldKey = await secrets.GetAsync(id, oldOrigin); }
            catch (OriginMismatchException) { }
        }
        ct.ThrowIfCancellationRequested();
        // Once persistence starts, complete or roll back without caller cancellation.
        if (!string.IsNullOrEmpty(key)) await secrets.SetAsync(key, id, origin);
        else if (changedOrigin) await secrets.DeleteAsync(id);
        try
        {
            await settings.UpdateAsync(s => s with
            {
                Connections = s.Connections.Any(c => c.Id == id) ? s.Connections.Select(c => c.Id == id ? connection : c).ToArray() : [.. s.Connections, connection],
                ActiveConnectionId = id,
                ConsentedOrigins = consent && !s.ConsentedOrigins.Contains(origin) ? [.. s.ConsentedOrigins, origin] : s.ConsentedOrigins
            });
        }
        catch
        {
            if (oldKey is not null && oldOrigin is not null) await secrets.SetAsync(oldKey, id, oldOrigin);
            else await secrets.DeleteAsync(id);
            throw;
        }
        return connection;
    }

    public async Task RemoveAsync(string id)
    {
        await secrets.DeleteAsync(id);
        await settings.UpdateAsync(s => s with { Connections = s.Connections.Where(c => c.Id != id).ToArray(), ActiveConnectionId = s.ActiveConnectionId == id ? null : s.ActiveConnectionId });
    }

    public async Task<IReadOnlyList<ModelInfo>> ModelsAsync(string connectionId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var state = await settings.ReadAsync();
        var connection = state.Connections.FirstOrDefault(c => c.Id == connectionId) ?? throw new RunnerException(new RunnerError.NoConnection());
        var origin = Origins.OriginOf(connection.BaseUrl) ?? throw new ArgumentException(nameof(DraftProblem.BaseUrl));
        if (!Origins.IsAllowedEndpoint(connection.BaseUrl)) throw new RunnerException(new RunnerError.Backend(new BackendException(ErrorKind.Offline)));
        if (!Origins.IsLocalHost(new Uri(origin).Host) && !state.ConsentedOrigins.Contains(origin)) throw new RunnerException(new RunnerError.ConsentNeeded(origin));
        string? key;
        try { key = await secrets.GetAsync(connectionId, origin); }
        catch (OriginMismatchException) { throw new RunnerException(new RunnerError.KeyMissing()); }
        if (ProviderEffort.NeedsKey(connection.Preset, connection.BaseUrl) && string.IsNullOrEmpty(key)) throw new RunnerException(new RunnerError.KeyMissing());
        return await ListModelsAsync(new ProviderClient(connection, key, transport), ct);
    }

    private static async Task<(IReadOnlyList<ModelInfo> Models, ModelInfo? Default)> ModelsWithDefaultAsync(ProviderClient client, CancellationToken ct)
    {
        try { return await client.ModelsWithDefaultAsync(ct); }
        catch (BackendException e) when (e.Kind == ErrorKind.Aborted && ct.IsCancellationRequested) { throw new OperationCanceledException(ct); }
    }

    private static async Task<IReadOnlyList<ModelInfo>> ListModelsAsync(ProviderClient client, CancellationToken ct)
    {
        try { return await client.ListModelsAsync(ct); }
        catch (BackendException e) when (e.Kind == ErrorKind.Aborted && ct.IsCancellationRequested) { throw new OperationCanceledException(ct); }
    }

    public Task<bool> KeyStateAsync(string connectionId) => secrets.HasAsync(connectionId);
}

namespace ByoGlot.Core;

public sealed class OriginMismatchException : Exception;
public interface ISecretStore
{
    Task SetAsync(string secret, string connectionId, string origin);
    Task<string?> GetAsync(string connectionId, string origin);
    Task<bool> HasAsync(string connectionId);
    Task DeleteAsync(string connectionId);
}
public interface ISettingsRepository
{
    Task<AppSettings> ReadAsync();
    Task<AppSettings> UpdateAsync(Func<AppSettings, AppSettings> change);
}

public sealed class InMemorySecretStore : ISecretStore
{
    private readonly Dictionary<string, (string Origin, string Secret)> values = [];
    private readonly object gate = new();
    public Task SetAsync(string secret, string connectionId, string origin)
    {
        lock (gate) values[connectionId] = (origin, secret);
        return Task.CompletedTask;
    }
    public Task<string?> GetAsync(string connectionId, string origin)
    {
        lock (gate)
        {
            if (!values.TryGetValue(connectionId, out var value)) return Task.FromResult<string?>(null);
            if (value.Origin != origin) throw new OriginMismatchException();
            return Task.FromResult<string?>(value.Secret);
        }
    }
    public Task<bool> HasAsync(string connectionId)
    {
        lock (gate) return Task.FromResult(values.ContainsKey(connectionId));
    }
    public Task DeleteAsync(string connectionId)
    {
        lock (gate) values.Remove(connectionId);
        return Task.CompletedTask;
    }
}

public sealed class InMemorySettingsRepository(AppSettings initial) : ISettingsRepository
{
    private AppSettings value = initial;
    private readonly object gate = new();
    public Task<AppSettings> ReadAsync()
    {
        lock (gate) return Task.FromResult(value);
    }
    public Task<AppSettings> UpdateAsync(Func<AppSettings, AppSettings> change)
    {
        lock (gate)
        {
            value = change(value);
            return Task.FromResult(value);
        }
    }
}

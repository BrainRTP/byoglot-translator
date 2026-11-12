namespace ByoGlot.Core;

public enum ErrorKind { Offline, Unauthorized, RateLimit, ProviderAuth, ProviderError, BadResponse, Incompatible, NoModel, Aborted }

public static class ErrorKindWire
{
    public static string Wire(this ErrorKind kind) => kind switch
    {
        ErrorKind.Offline => "offline",
        ErrorKind.Unauthorized => "unauthorized",
        ErrorKind.RateLimit => "rate_limit",
        ErrorKind.ProviderAuth => "provider_auth",
        ErrorKind.ProviderError => "provider_error",
        ErrorKind.BadResponse => "bad_response",
        ErrorKind.Incompatible => "incompatible",
        ErrorKind.NoModel => "no_model",
        ErrorKind.Aborted => "aborted",
        _ => throw new ArgumentOutOfRangeException(nameof(kind))
    };
}

public sealed class BackendException(ErrorKind kind, int? status = null, long? retryAfterMs = null, string? detail = null) : Exception(kind.Wire())
{
    public ErrorKind Kind { get; } = kind;
    public int? Status { get; } = status;
    public long? RetryAfterMs { get; } = retryAfterMs;
    public string? Detail { get; } = detail;
    public bool IsFatal => Kind != ErrorKind.BadResponse;
}

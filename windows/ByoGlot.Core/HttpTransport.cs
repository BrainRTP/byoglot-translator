namespace ByoGlot.Core;

public sealed record HttpRequestData(string Method, string Url, IReadOnlyDictionary<string, string> Headers, byte[]? Body);
public sealed record HttpResponseData(int Status, IReadOnlyDictionary<string, string> Headers, byte[] Body);
public enum TransportFailure { Offline, Timeout }
public sealed class TransportException(TransportFailure reason, Exception? inner = null) : Exception(reason.ToString(), inner)
{
    public TransportFailure Reason { get; } = reason;
}
public interface IHttpTransport
{
    Task<HttpResponseData> SendAsync(HttpRequestData request, TimeSpan timeout, CancellationToken ct);
}

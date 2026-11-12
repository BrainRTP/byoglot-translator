using ByoGlot.Core;

namespace ByoGlot.App.Services;

public sealed class HttpClientTransport : IHttpTransport, IDisposable
{
    private const int BodyLimit = 8 * 1024 * 1024;
    private readonly HttpClient client = new(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = Timeout.InfiniteTimeSpan };

    public async Task<HttpResponseData> SendAsync(HttpRequestData request, TimeSpan timeout, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(timeout > TimeSpan.FromSeconds(180) ? TimeSpan.FromSeconds(180) : timeout);
        try
        {
            var url = request.Url;
            for (var redirects = 0; ; redirects++)
            {
                if (!Origins.IsAllowedEndpoint(url)) throw new TransportException(TransportFailure.Offline);
                using var message = new HttpRequestMessage(new HttpMethod(request.Method), url);
                if (request.Body is not null) message.Content = new ByteArrayContent(request.Body);
                foreach (var header in request.Headers)
                    if (!message.Headers.TryAddWithoutValidation(header.Key, header.Value)) message.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value);
                using var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, deadline.Token).ConfigureAwait(false);
                var status = (int)response.StatusCode;
                if (status is 301 or 302 or 303 or 307 or 308 && response.Headers.Location is { } location && redirects < 5)
                {
                    var target = new Uri(new Uri(url), location).AbsoluteUri;
                    // A different origin has never received consent for this request.
                    if (Origins.OriginOf(target) == Origins.OriginOf(url) && Origins.IsAllowedEndpoint(target))
                    {
                        url = target;
                        continue;
                    }
                }
                var headers = response.Headers.Concat(response.Content.Headers).ToDictionary(h => h.Key.ToLowerInvariant(), h => string.Join(", ", h.Value));
                if (response.Content.Headers.ContentLength > BodyLimit) throw new TransportException(TransportFailure.Offline);
                await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token).ConfigureAwait(false);
                using var body = new MemoryStream();
                var buffer = new byte[8192];
                int count;
                while ((count = await stream.ReadAsync(buffer, deadline.Token).ConfigureAwait(false)) != 0)
                {
                    if (body.Length + count > BodyLimit) throw new TransportException(TransportFailure.Offline);
                    body.Write(buffer, 0, count);
                }
                return new(status, headers, body.ToArray());
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw new OperationCanceledException(ct); }
        catch (OperationCanceledException) { throw new TransportException(TransportFailure.Timeout); }
        catch (HttpRequestException) { throw new TransportException(TransportFailure.Offline); }
        catch (IOException) { throw new TransportException(TransportFailure.Offline); }
        catch (UriFormatException) { throw new TransportException(TransportFailure.Offline); }
    }

    public void Dispose() => client.Dispose();
}

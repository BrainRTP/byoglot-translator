using System.Net;
using System.Net.Sockets;
using System.Text;

namespace ByoGlot.App.Tests;

public sealed class HttpClientTransportTests
{
    private sealed class Server : IDisposable
    {
        private readonly HttpListener listener = new();
        public string Url { get; }
        public Server()
        {
            using var socket = new TcpListener(IPAddress.Loopback, 0);
            socket.Start();
            var port = ((IPEndPoint)socket.LocalEndpoint).Port;
            socket.Stop();
            Url = $"http://127.0.0.1:{port}/";
            listener.Prefixes.Add(Url);
            listener.Start();
        }
        public Task<HttpListenerContext> Accept() => listener.GetContextAsync();
        public void Dispose() => listener.Close();
    }
    private static HttpRequestData Request(string url) => new("POST", url, new Dictionary<string, string> { ["authorization"] = "Bearer private-key", ["content-type"] = "application/json" }, Encoding.UTF8.GetBytes("{}"));
    private static async Task Reply(HttpListenerContext context, int status, string body = "ok", string? location = null)
    {
        context.Response.StatusCode = status;
        context.Response.Headers["x-test"] = "yes";
        if (location is not null) context.Response.RedirectLocation = location;
        await context.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(body), TestContext.Current.CancellationToken);
        context.Response.Close();
    }
    [Fact] public async Task ReturnsStatusHeadersAndBody()
    {
        using var server = new Server();
        using var transport = new HttpClientTransport();
        var pending = transport.SendAsync(Request(server.Url), TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await Reply(await server.Accept(), 201);
        var response = await pending;
        Assert.Equal(201, response.Status);
        Assert.Equal("yes", response.Headers["x-test"]);
        Assert.Equal("ok", Encoding.UTF8.GetString(response.Body));
    }
    [Fact] public async Task RefusesCleartextToAPublicHost()
    {
        using var transport = new HttpClientTransport();
        Assert.Equal(TransportFailure.Offline, (await Assert.ThrowsAsync<TransportException>(() => transport.SendAsync(Request("http://example.com"), TimeSpan.FromSeconds(1), TestContext.Current.CancellationToken))).Reason);
    }
    [Fact] public async Task DropsAuthorizationOnACrossOriginRedirect()
    {
        using var source = new Server();
        using var target = new Server();
        using var transport = new HttpClientTransport();
        var pending = transport.SendAsync(Request(source.Url), TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await Reply(await source.Accept(), 307, location: target.Url);
        Assert.Equal(307, (await pending).Status);
        var unexpected = target.Accept();
        Assert.NotSame(unexpected, await Task.WhenAny(unexpected, Task.Delay(50, TestContext.Current.CancellationToken)));
    }
    [Fact] public async Task KeepsAuthorizationOnASameOriginRedirect()
    {
        using var server = new Server();
        using var transport = new HttpClientTransport();
        var pending = transport.SendAsync(Request(server.Url), TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await Reply(await server.Accept(), 307, location: server.Url + "next");
        var next = await server.Accept();
        Assert.Equal("Bearer private-key", next.Request.Headers["authorization"]);
        await Reply(next, 200);
        Assert.Equal(200, (await pending).Status);
    }
    [Fact] public async Task CancellationThrowsOperationCanceled()
    {
        using var server = new Server();
        using var transport = new HttpClientTransport();
        using var cancel = new CancellationTokenSource();
        var pending = transport.SendAsync(Request(server.Url), TimeSpan.FromSeconds(5), cancel.Token);
        var context = await server.Accept();
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending);
        context.Response.Abort();
    }
    [Fact] public async Task TimesOut()
    {
        using var server = new Server();
        using var transport = new HttpClientTransport();
        var pending = transport.SendAsync(Request(server.Url), TimeSpan.FromMilliseconds(100), TestContext.Current.CancellationToken);
        var context = await server.Accept();
        Assert.Equal(TransportFailure.Timeout, (await Assert.ThrowsAsync<TransportException>(() => pending)).Reason);
        context.Response.Abort();
    }
    [Fact] public async Task DeadlineIncludesASlowResponseBody()
    {
        using var server = new Server();
        using var transport = new HttpClientTransport();
        var pending = transport.SendAsync(Request(server.Url), TimeSpan.FromMilliseconds(150), TestContext.Current.CancellationToken);
        var context = await server.Accept();
        context.Response.SendChunked = true;
        await context.Response.OutputStream.WriteAsync(new byte[] { 1 }, TestContext.Current.CancellationToken);
        await context.Response.OutputStream.FlushAsync(TestContext.Current.CancellationToken);
        Assert.Equal(TransportFailure.Timeout, (await Assert.ThrowsAsync<TransportException>(() => pending)).Reason);
        context.Response.Abort();
    }
}

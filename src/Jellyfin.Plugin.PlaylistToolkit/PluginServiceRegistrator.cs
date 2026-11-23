using Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;
using Jellyfin.Plugin.PlaylistToolkit.Services;
using Jellyfin.Plugin.PlaylistToolkit.Web;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Jellyfin.Plugin.PlaylistToolkit;

/// <summary>
/// Registers the plugin's services with the server's DI container.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<PlaylistAccessService>();
        serviceCollection.AddSingleton<IContainerDislikeReader, UserDataContainerDislikeReader>();
        serviceCollection.AddSingleton<PlaylistContentService>();
        serviceCollection.AddSingleton<M3uService>();
        serviceCollection.AddSingleton<IUserMarkStore, UserDataMarkStore>();
        serviceCollection.AddSingleton<ArtistNames.ArtistSortService>();
        serviceCollection.AddSingleton<AutoPlaylistService>();
        serviceCollection.AddSingleton<AutoPlaylistWorker>();
        serviceCollection.AddHostedService(provider => provider.GetRequiredService<AutoPlaylistWorker>());

        // Startup filters run before Jellyfin's own pipeline, so the middleware can wrap the
        // static file response for index.html without touching files on disk.
        serviceCollection.AddTransient<IStartupFilter, ScriptInjectionStartupFilter>();
    }
}

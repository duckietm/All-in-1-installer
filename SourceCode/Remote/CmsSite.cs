namespace AllInOneInstaller.Remote;

/// <summary>
/// A CMS' own NGINX site (AtomCMS or your own CMS) on 127.0.0.1, on the first free port from 85 to 95. Traefik sends it
/// the hotel's address except /client, /gamedata and /custom (the hotel site on port 85) and Polaris' paths.
/// </summary>
public static class CmsSite
{
    public const int FirstPort = LocalPorts.First;
    public const int LastPort = LocalPorts.Last;

    /// <summary>/etc/nginx/sites-available/cms-&lt;name&gt;.</summary>
    public static string File(string name) => $"/etc/nginx/sites-available/cms-{name}";

    private static string Config(WebAccessSettings site, string name, string root, bool php)
    {
        string serverName = site.IsIpAddress ? "_" : site.Address.StartsWith("www.", StringComparison.Ordinal)
            ? $"{site.Address} {site.Address[4..]}" : $"{site.Address} www.{site.Address}";
        string hsts = site.Https ? "    add_header Strict-Transport-Security \"max-age=2592000\" always;\n" : "";
        // A static site serves its files; an address without a file is a 404.
        const string StaticLocations = """
                location / {
                    try_files $uri $uri/ =404;
                }

                location ~ /\.(git|ht|env) {
                    deny all;
                }
            """;
        return $$"""
            # {{name}}: the hotel's website (written by All-in-1 Installer, Addons → CMS). {{(php ? "PHP 8.5" : "A static website")}} from {{root}}.
            # Traefik (/opt/traefik) passes {{site.Url}} here, except /client, /gamedata and /custom (the hotel site on
            # 127.0.0.1:{{HotelSite.Port}}) and Polaris' /ws and /api paths.

            server {
                listen 127.0.0.1:@PORT@;
                server_name {{serverName}};

                root {{root}};
                index {{(php ? "index.php index.html" : "index.html index.htm")}};

                autoindex     off;
                server_tokens off;

                # The visitor's address from X-Forwarded-For, past Traefik (and Cloudflare), as for the hotel site.
                include {{HotelSite.RealIpFile}};
                real_ip_header    X-Forwarded-For;
                real_ip_recursive on;

                add_header X-Content-Type-Options "nosniff" always;
            {{hsts}}    add_header Referrer-Policy        "strict-origin";

                # Next to the hotel site's, so Debug → NGINX shows them too.
                access_log {{HotelSite.LogDirectory}}/access.log;
                error_log  {{HotelSite.LogDirectory}}/error.log;

            {{(php ? HotelSite.PhpLocations : StaticLocations)}}
            }
            """;
    }

    /// <summary>
    /// Writes and enables the site, on the port it had or the first free one from 85 to 95, and disables the site of
    /// another CMS (its files stay). Prints PORT=. Does not change Traefik.
    /// </summary>
    public static string WriteScript(WebAccessSettings site, string name, string root, bool php) => $$"""
        [ -d /etc/nginx/sites-available ] || fail "NGINX is not installed with sites-available. Run the NGINX step first."
        f={{File(name)}}
        {{LocalPorts.Functions}}
        # The port this CMS had, when it is still free for it; otherwise the first free one.
        self_file=$f
        pick_port "$(grep -sE '^[[:space:]]*listen[[:space:]]+127\.0\.0\.1:[0-9]+' "$f" | head -1 | grep -oE '[0-9]+;' | tr -d ';')"
        install -d -m 755 {{HotelSite.LogDirectory}}
        # The proxies the visitor's address is read past: servers set up before this file existed do not have it yet.
        {{HotelSite.RealIpScript(site)}}
        echo "> $f: listen 127.0.0.1:$port, root {{root}} ({{(php ? "PHP" : "static")}})"
        cat > "$f" <<'SITE'
        {{Config(site, name, root, php)}}
        SITE
        sed -i "s#@PORT@#$port#" "$f"
        enabled=/etc/nginx/sites-enabled/cms-{{name}}
        ln -sfn "$f" "$enabled"
        nginx -t 2>&1 | sed 's/^/  /'
        if ! nginx -t >/dev/null 2>&1; then
          # Never leave NGINX with a configuration it refuses: its next restart, or a reboot, would fail.
          rm -f "$enabled"
          echo "  cms-{{name}} is disabled again, so NGINX keeps a configuration it accepts"
          fail "nginx -t refuses the configuration (see above). NGINX was not reloaded: the hotel keeps running as it was."
        fi
        # One CMS is the website at a time: the others go off once this one is accepted.
        for other in /etc/nginx/sites-enabled/cms-*; do
          [ -e "$other" ] || [ -L "$other" ] || continue
          [ "$other" = "$enabled" ] && continue
          rm -f "$other"
          echo "  $(basename "$other") is no longer the website (disabled; its files and sites-available/$(basename "$other") stay)"
        done
        if [ -d /run/systemd/system ]; then systemctl reload nginx || systemctl restart nginx; else nginx -s reload 2>/dev/null || service nginx restart; fi
        sleep 1
        code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)
        echo "  http://127.0.0.1:$port/ answers HTTP $code"
        [ -n "$code" ] && [ "$code" != 000 ] || fail "NGINX does not answer on 127.0.0.1:$port."
        echo "PORT=$port"
        """;

    /// <summary>
    /// Disables every CMS site (the hotel site then is the only one), and with <paramref name="deleteFolder"/> deletes that
    /// CMS' folder and NGINX site file. Reloads NGINX once nginx -t accepts it.
    /// </summary>
    public static Task RemoveAsync(ServerConnection connection, string? siteName, string? deleteFolder, Action<string> log, CancellationToken token = default)
    {
        string delete = deleteFolder is null || siteName is null ? "" : $$"""
            d={{ServerConnection.ShellQuote(deleteFolder)}}
            case "$d" in /var/www/?*) ;; *) fail "Refusing to delete $d: not a folder in /var/www." ;; esac
            if [ -d "$d" ]; then
              echo "> Deleting $d ($(du -sh "$d" | cut -f1))"
              rm -rf -- "$d"
            fi
            rm -f {{File(siteName)}}
            echo "  {{File(siteName)}} deleted"
            """;
        string script = RemoteScript.Prelude + $$"""
            off=0
            for s in /etc/nginx/sites-enabled/cms-*; do
              [ -e "$s" ] || [ -L "$s" ] || continue
              rm -f "$s"
              off=$((off + 1))
              echo "> $(basename "$s") disabled: NGINX no longer serves it"
            done
            [ $off -gt 0 ] || echo "  No CMS site was enabled"
            {{delete}}
            nginx -t 2>&1 | sed 's/^/  /'
            nginx -t >/dev/null 2>&1 || fail "nginx -t refuses the configuration (see above)."
            if [ -d /run/systemd/system ]; then systemctl reload nginx || systemctl restart nginx; else nginx -s reload 2>/dev/null || service nginx restart; fi
            echo "  NGINX reloaded"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Removing the CMS site failed", token);
    }

    /// <summary>Runs <see cref="WriteScript"/>; returns the port.</summary>
    public static async Task<int> ApplyAsync(ServerConnection connection, WebAccessSettings site, string name, string root, bool php,
        Action<string> log, CancellationToken token = default)
    {
        ScriptValues values = await RemoteScript.RunCapturingAsync(connection, RemoteScript.Prelude + WriteScript(site, name, root, php), log,
            $"Setting up the NGINX site for {name} failed", ["PORT"], token);
        return values.Int("PORT") is > 0 and var port ? port : throw new ServerConnectionException($"The NGINX site for {name} has no port.");
    }
}

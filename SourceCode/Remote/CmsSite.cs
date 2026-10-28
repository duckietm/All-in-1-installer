namespace AllInOneInstaller.Remote;

/// <summary>
/// A CMS' own NGINX site (AtomCMS or your own CMS) on 127.0.0.1, on the first free port from 85 to 95. Traefik sends it
/// the hotel's address except /client, /gamedata and /custom (the hotel site on port 85) and Polaris' paths.
/// </summary>
public static class CmsSite
{
    public const int FirstPort = 85;
    public const int LastPort = 95;

    // Every container's name and the host ports it publishes, also when it is stopped (docker ps only shows running ones).
    // Go template braces cannot appear in the $$ raw strings.
    private const string DockerPorts = "{{.Name}} {{range $p, $c := .HostConfig.PortBindings}}{{range $c}}{{.HostPort}} {{end}}{{end}}";

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
        # Why a port cannot be used, or nothing when it is free: something listens on it (any address, IPv4 or IPv6),
        # another NGINX site or config uses it, or a Docker container (also a stopped one) publishes it.
        port_taken() {
          who=$(ss -Hltnp "sport = :$1" 2>/dev/null | grep -oE 'users:\(\("[^"]+"' | head -1 | cut -d'"' -f2)
          if ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; then
            # Our own site may listen there already (a run again): that is not taken.
            [ "$who" = nginx ] && grep -qsE "listen[[:space:]]+([^;[:space:]]*:)?$1([[:space:]]|;)" "$f" && return 1
            echo "in use by ${who:-a program}"; return 0
          fi
          other=$(grep -rlsE "^[^#]*listen[[:space:]]+([^;[:space:]]*:)?$1([[:space:]]|;)" /etc/nginx 2>/dev/null | grep -vx "$f" | head -1)
          [ -n "$other" ] && { echo "used by $other"; return 0; }
          if command -v docker >/dev/null 2>&1; then
            container=$(docker ps -aq 2>/dev/null | xargs -r docker inspect -f '{{DockerPorts}}' 2>/dev/null | grep -E " $1( |$)" | head -1 | awk '{print $1}' | tr -d /)
            [ -n "$container" ] && { echo "published by the Docker container $container"; return 0; }
          fi
          return 1
        }
        # The port this CMS had, when it is still free for it; otherwise the first free one.
        port=$(grep -sE '^[[:space:]]*listen[[:space:]]+127\.0\.0\.1:[0-9]+' "$f" | head -1 | grep -oE '[0-9]+;' | tr -d ';')
        if [ -n "$port" ] && reason=$(port_taken "$port"); then
          echo "  Port $port, which this CMS had, is $reason now: choosing another one"
          port=
        fi
        if [ -z "$port" ]; then
          for p in $(seq {{FirstPort}} {{LastPort}}); do
            if reason=$(port_taken "$p"); then echo "  Port $p: $reason"; continue; fi
            port=$p; break
          done
        fi
        [ -n "$port" ] || fail "Ports {{FirstPort}} to {{LastPort}} are all in use on 127.0.0.1: free one for the CMS and try again."
        install -d -m 755 {{HotelSite.LogDirectory}}
        echo "> $f: listen 127.0.0.1:$port, root {{root}} ({{(php ? "PHP" : "static")}})"
        cat > "$f" <<'SITE'
        {{Config(site, name, root, php)}}
        SITE
        sed -i "s#@PORT@#$port#" "$f"
        ln -sfn "$f" /etc/nginx/sites-enabled/cms-{{name}}
        # One CMS is the website at a time.
        for other in /etc/nginx/sites-enabled/cms-*; do
          [ -e "$other" ] || [ -L "$other" ] || continue
          [ "$other" = /etc/nginx/sites-enabled/cms-{{name}} ] && continue
          rm -f "$other"
          echo "  $(basename "$other") is no longer the website (disabled; its files and sites-available/$(basename "$other") stay)"
        done
        nginx -t 2>&1 | sed 's/^/  /'
        nginx -t >/dev/null 2>&1 || fail "nginx -t refuses the configuration (see above)."
        if [ -d /run/systemd/system ]; then systemctl reload nginx || systemctl restart nginx; else nginx -s reload 2>/dev/null || service nginx restart; fi
        sleep 1
        code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)
        echo "  http://127.0.0.1:$port/ answers HTTP $code"
        [ -n "$code" ] && [ "$code" != 000 ] || fail "NGINX does not answer on 127.0.0.1:$port."
        echo "PORT=$port"
        """;

    /// <summary>Runs <see cref="WriteScript"/>; returns the port.</summary>
    public static async Task<int> ApplyAsync(ServerConnection connection, WebAccessSettings site, string name, string root, bool php,
        Action<string> log, CancellationToken token = default)
    {
        ScriptValues values = await RemoteScript.RunCapturingAsync(connection, RemoteScript.Prelude + WriteScript(site, name, root, php), log,
            $"Setting up the NGINX site for {name} failed", ["PORT"], token);
        return values.Int("PORT") is > 0 and var port ? port : throw new ServerConnectionException($"The NGINX site for {name} has no port.");
    }
}

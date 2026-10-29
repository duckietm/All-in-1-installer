namespace AllInOneInstaller.Remote;

/// <summary>
/// How the hotel is reached from the internet. With a CMS (AtomCMS, or your own CMS in /var/www/&lt;CustomCms&gt;) the CMS
/// is the site and Octane moves to /client. <see cref="CmsPort"/> is the CMS' own NGINX site on 127.0.0.1 (85-95);
/// 0 for an AtomCMS set up before that, which the hotel site on port 85 still serves itself.
/// </summary>
public sealed record WebAccessSettings(string Address, bool Https, bool Cloudflare, bool AtomCms = false, string? CustomCms = null, int CmsPort = 0,
    bool EpicNext = false)
{
    public string Scheme => Https ? "https" : "http";
    public bool HasCms => AtomCms || EpicNext || CustomCms is not null;
    /// <summary>The CMS has its own NGINX site; Traefik sends it everything except /client, /gamedata, /custom and Polaris.</summary>
    public bool CmsOnOwnPort => HasCms && CmsPort > 0;
    /// <summary>"AtomCMS", the custom CMS' folder name, or null.</summary>
    public string? CmsName => AtomCms ? "AtomCMS" : EpicNext ? "EpicNext CMS" : CustomCms;
    /// <summary>Where Octane is served, "/" or "/client/".</summary>
    public string ClientPath => HasCms ? "/client/" : "/";
    public string ClientUrl => Url + ClientPath;
    public string Url => $"{Scheme}://{(Address.Contains(':') ? $"[{Address}]" : Address)}";
    /// <summary>For a bare IP address Traefik answers for every host name.</summary>
    public bool IsIpAddress => System.Net.IPAddress.TryParse(Address, out _);

    /// <summary>Reads /opt/traefik/hotel.env as printed with a conf_ prefix. Null before the web access step.</summary>
    public static WebAccessSettings? FromHotelEnv(ScriptValues values) =>
        values["conf_ADDRESS"] is { } address
            ? new WebAccessSettings(address, values["conf_SCHEME"] == "https", values.Yes("conf_CLOUDFLARE"), values["conf_CMS"] == "atom",
                values["conf_CMS"] == "custom" ? values["conf_CMS_NAME"] : null, values.Int("conf_CMS_PORT"), values["conf_CMS"] == "epicnext")
            : null;
}

/// <summary>Docker, Traefik and NGINX state before the step runs.</summary>
public sealed record WebAccessState(
    string? DockerVersion,
    bool DockerFromDocker,
    IReadOnlyList<string> ConflictingPackages,
    bool DockerRunning,
    bool TraefikRunning,
    bool SiteEnabled,
    WebAccessSettings? Configured,
    string? Port80Process,
    string? Port443Process,
    bool EmulatorRunning)
{
    public bool IsComplete => DockerFromDocker && DockerRunning && TraefikRunning && SiteEnabled && Configured is not null;
}

public sealed record WebAccessResult(bool CertificateValid, string? CertificateProblem, bool ApiAnswered, bool WebSocketAnswered);

/// <summary>
/// Puts Traefik in Docker in front of the hotel on 80/443 with Let's Encrypt. /ws and /api go to Polaris,
/// everything else to NGINX on localhost:85.
/// </summary>
public static class WebAccessInstaller
{
    public const string TraefikDirectory = "/opt/traefik";
    public const string NginxPort = HotelSite.Port;
    public const string PolarisPort = "2096";
    public const string SiteFile = HotelSite.File;

    /// <summary>"Docker Release (CE deb)" key from download.docker.com/linux/&lt;distro&gt;/gpg.</summary>
    public const string DockerKeyFingerprint = "9DC858229FC7DD38854AE2D88D81803C0EBFCD88";

    // Every key currently in Docker's gpg file. Any other key is refused.
    private static readonly string[] KnownDockerKeys = [DockerKeyFingerprint, "D3306A018370199E527AE7997EA0A9C3F273FCD8"];

    /// <summary>From docs.docker.com/engine/install, "Uninstall old versions".</summary>
    public const string ConflictingPackages = "docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc";

    // Go template braces cannot appear in the $$ raw strings.
    private const string GoRunning = "{{.State.Running}}";

    // Name of the process listening on the port, or empty when there is none.
    private static string PortOwner(int port) =>
        $"ss -Hltnp 'sport = :{port}' 2>/dev/null | grep -oE 'users:\\(\\(\"[^\"]+\"' | head -1 | cut -d'\"' -f2";

    public static async Task<WebAccessState> InspectAsync(ServerConnection connection, CancellationToken token = default)
    {
        string script = $$"""
            echo "docker=$(dpkg-query -W -f='${db:Status-Abbrev}${Version}' docker-ce 2>/dev/null | awk '/^ii/{print substr($0,4)}')"
            echo "dockerorg=$(apt-cache policy docker-ce 2>/dev/null | grep -q download.docker.com && echo yes)"
            echo "conflicts=$(dpkg-query -W -f='${db:Status-Abbrev}${Package}\n' {{ConflictingPackages}} 2>/dev/null | awk '/^ii/{printf "%s ", substr($0,4)}')"
            echo "dockerrunning=$(docker info >/dev/null 2>&1 && echo yes)"
            echo "traefik=$(docker inspect -f '{{GoRunning}}' traefik 2>/dev/null)"
            echo "site=$([ -L /etc/nginx/sites-enabled/hotel ] && grep -qs 'listen 127.0.0.1:{{NginxPort}}' {{SiteFile}} && echo yes)"
            [ -f {{TraefikDirectory}}/hotel.env ] && sed 's/^/conf_/' {{TraefikDirectory}}/hotel.env
            echo "port80=$({{PortOwner(80)}})"
            echo "port443=$({{PortOwner(443)}})"
            echo "emulator=$(ss -Hltn 'sport = :{{PolarisPort}}' 2>/dev/null | grep -q . && echo yes)"
            """;
        CommandResult result = await connection.RunAsRootAsync(script, token);
        var values = new ScriptValues(result.Output);

        WebAccessSettings? configured = WebAccessSettings.FromHotelEnv(values);
        // "5:29.9.2-1~ubuntu.24.04~noble" -> "29.9.2"
        string? docker = values["docker"] is { } package ? package[(package.IndexOf(':') + 1)..].Split('-')[0] : null;
        return new WebAccessState(docker, values.Yes("dockerorg"),
            (values["conflicts"] ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries),
            values.Yes("dockerrunning"), values["traefik"] == "true", values.Yes("site"), configured,
            values["port80"], values["port443"], values.Yes("emulator"));
    }

    /// <summary>Follows docs.docker.com/engine/install/ubuntu and /debian, with a verified key.</summary>
    public static Task InstallDockerAsync(ServerConnection connection, Action<string> log, CancellationToken token = default)
    {
        string known = string.Join('|', KnownDockerKeys);
        string script = RemoteScript.Prelude + $$"""
            case "$ID" in
              ubuntu|debian) distro=$ID ;;
              *) fail "Docker's repository is for Ubuntu and Debian; this server runs $ID." ;;
            esac
            conflicts=$(dpkg-query -W -f='${db:Status-Abbrev}${Package}\n' {{ConflictingPackages}} 2>/dev/null | awk '/^ii/{printf "%s ", substr($0,4)}')
            if [ -n "$conflicts" ]; then
              echo "> Removing packages that conflict with Docker Engine: $conflicts"
              apt-get remove -y $conflicts
            fi

            echo "> Adding the Docker repository (download.docker.com/linux/$distro)"
            apt_update >/dev/null
            apt-get install -y ca-certificates curl gnupg
            install -m 0755 -d /etc/apt/keyrings
            tmp=$(mktemp)
            curl -fsSL "https://download.docker.com/linux/$distro/gpg" -o "$tmp" || fail "Could not download Docker's signing key."
            fingerprints=$(gpg --show-keys --with-colons "$tmp" 2>/dev/null | awk -F: '$1=="fpr" {print $10}')
            echo "$fingerprints" | grep -qx '{{DockerKeyFingerprint}}' || { rm -f "$tmp"; fail "Docker's signing key does not have the published fingerprint {{DockerKeyFingerprint}}."; }
            for fpr in $fingerprints; do
              echo "$fpr" | grep -Eqx '{{known}}' || { rm -f "$tmp"; fail "Docker's key file contains an unknown key $fpr."; }
            done
            echo "  key {{DockerKeyFingerprint}} checked"
            install -m 0644 "$tmp" /etc/apt/keyrings/docker.asc
            rm -f "$tmp"
            # The format docs.docker.com uses now. An older docker.list would add the same repository twice.
            rm -f /etc/apt/sources.list.d/docker.list
            cat > /etc/apt/sources.list.d/docker.sources <<EOF
            Types: deb
            URIs: https://download.docker.com/linux/$distro
            Suites: $codename
            Components: stable
            Architectures: $(dpkg --print-architecture)
            Signed-By: /etc/apt/keyrings/docker.asc
            EOF
            apt_update 2>&1 | grep -E 'docker|^(E|W):' || true
            apt-cache policy docker-ce | grep -q download.docker.com || fail "Docker has no packages for $PRETTY_NAME ($codename) yet."

            echo "> apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
            apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

            echo "> Starting Docker"
            if [ -d /run/systemd/system ]; then
              systemctl enable --now docker
            elif ! docker info >/dev/null 2>&1; then
              service docker start || (setsid dockerd </dev/null >/var/log/dockerd.log 2>&1 &)
            fi
            for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
            docker info >/dev/null 2>&1 || fail "Docker is installed, but the Docker daemon does not run (see journalctl -u docker)."
            docker --version
            docker compose version
            """;
        return RemoteScript.RunAsync(connection, script, log, "Installing Docker failed", token);
    }

    /// <summary>Moves the hotel site to 127.0.0.1:85 and the default site off port 80, which Traefik needs.</summary>
    public static Task ConfigureNginxAsync(ServerConnection connection, WebAccessSettings settings, Action<string> log,
        CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + HotelSite.WriteScript(settings, root: null);
        return RemoteScript.RunAsync(connection, script, log, "Configuring NGINX failed", token);
    }

    /// <summary>With Cloudflare, X-Forwarded-For is trusted only from Cloudflare's published ranges.</summary>
    public static Task ConfigureTraefikAsync(ServerConnection connection, WebAccessSettings settings, Action<string> log,
        CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            t={{TraefikDirectory}}
            install -d -m 755 "$t" "$t/dynamic"
            install -d -m 700 "$t/letsencrypt"

            {{StaticConfigScript(settings)}}

            {{RoutesScript(settings)}}

            {{ComposeScript()}}

            echo "> docker compose pull (traefik:v3)"
            pulled=
            for i in 1 2 3; do
              if compose_in "$t" pull -q 2>"$t/pull.log"; then pulled=yes; break; fi
              tail -1 "$t/pull.log" | sed 's/^/  /'
              [ $i -lt 3 ] && { echo "  Trying again in $((i * 20)) seconds ..."; sleep $((i * 20)); }
            done
            rm -f "$t/pull.log"
            if [ -z "$pulled" ]; then
              docker image inspect traefik:v3 >/dev/null 2>&1 || fail "Could not download the Traefik image from Docker Hub (see above). Try again later."
              echo "  Docker Hub did not answer: using the traefik:v3 image that is already on this server"
            fi
            echo "> docker compose up -d"
            compose_in "$t" up -d --force-recreate 2>&1 | grep -v '^ *$'
            {{WaitForTraefikScript}}

            ufw_allow 80/tcp 443/tcp
            """;
        return RemoteScript.RunAsync(connection, script, log, "Setting up Traefik failed", token);
    }

    /// <summary>Waits until the traefik container runs and listens on port 80; fails with its log otherwise.</summary>
    internal const string WaitForTraefikScript = $$"""
        for i in $(seq 1 20); do
          [ "$(docker inspect -f '{{GoRunning}}' traefik 2>/dev/null)" = true ] && ss -Hltn 'sport = :80' | grep -q . && break
          sleep 1
        done
        [ "$(docker inspect -f '{{GoRunning}}' traefik 2>/dev/null)" = true ] || { docker logs --tail 20 traefik 2>&1 | sed 's/^/  /'; fail "The Traefik container does not run."; }
        ss -Hltn 'sport = :80' | grep -q . || { docker logs --tail 20 traefik 2>&1 | sed 's/^/  /'; fail "Traefik runs, but does not listen on port 80."; }
        echo "  $(docker exec traefik traefik version 2>/dev/null | awk '/^Version/ {print "Traefik " $2}') is running"
        """;

    // Traefik's static configuration. With the CrowdSec addon: the access log CrowdSec reads, the bouncer plugin, and
    // the bouncer on both entry points (so on every route, Gitea's too). [TRUSTED] becomes Cloudflare's ranges.
    private static string StaticYaml(WebAccessSettings settings, bool crowdsec)
    {
        string middlewares = crowdsec ? $"\n      middlewares: [{CrowdSecInstaller.Middleware}@file]" : "";
        string web = settings.Https
            ? $"""

                http:
                  redirections:
                    entryPoint:
                      to: websecure
                      scheme: https{middlewares}
            """
            : crowdsec ? $"\n    http:{middlewares}" : "";
        string websecure = settings.Https ? $"""

              websecure:
                address: ":443"
                forwardedHeaders:
                  trustedIPs: [TRUSTED]{(crowdsec ? $"\n    http:{middlewares}" : "")}
            """ : "";
        string acme = settings.Https ? """

            certificatesResolvers:
              letsencrypt:
                acme:
                  storage: /letsencrypt/acme.json
                  httpChallenge:
                    entryPoint: web
            """ : "";
        string extra = crowdsec ? $"""

            # CrowdSec (Addons → CrowdSec): it reads this log; the plugin blocks the addresses it bans.
            accessLog:
              filePath: {CrowdSecInstaller.AccessLog}
            experimental:
              plugins:
                {CrowdSecInstaller.Plugin}:
                  moduleName: {CrowdSecInstaller.PluginModule}
                  version: {CrowdSecInstaller.PluginVersion}
            """ : "";
        return $"""
            # Traefik static configuration (written by All-in-1 Installer).
            entryPoints:
              web:
                address: ":80"
                forwardedHeaders:
                  trustedIPs: [TRUSTED]{web}{websecure}
            providers:
              file:
                directory: /etc/traefik/dynamic
                watch: true{acme}
            log:
              level: INFO
              noColor: true{extra}
            """;
    }

    /// <summary>
    /// Writes $t/traefik.yml, with the CrowdSec parts while the CrowdSec addon's middleware file exists. Only Cloudflare,
    /// when used, may set X-Forwarded-For; otherwise Traefik writes the visitor's address itself, so it cannot be faked.
    /// </summary>
    internal static string StaticConfigScript(WebAccessSettings settings) => $$"""
        trusted=
        if [ {{(settings.Cloudflare ? "yes" : "no")}} = yes ]; then
          load_cloudflare_ranges
          trusted=$(echo "$ranges" | sed 's/.*/"&"/' | paste -sd, -)
        fi
        if [ -f {{CrowdSecInstaller.MiddlewareFile}} ]; then
          echo "> $t/traefik.yml (with CrowdSec)"
          cat > "$t/traefik.yml" <<'EOF'
        {{StaticYaml(settings, true)}}
        EOF
        else
          echo "> $t/traefik.yml"
          cat > "$t/traefik.yml" <<'EOF'
        {{StaticYaml(settings, false)}}
        EOF
        fi
        sed -i "s#\[TRUSTED\]#[$trusted]#" "$t/traefik.yml"
        """;

    /// <summary>
    /// Writes $t/compose.yaml. With the host network Traefik reaches NGINX, Polaris (which trusts 127.0.0.1 as the proxy
    /// that sets X-Forwarded-For) and CrowdSec on 127.0.0.1. The access log folder and the plugin storage are for CrowdSec.
    /// </summary>
    internal static string ComposeScript() => $$"""
        echo "> $t/compose.yaml"
        install -d -m 755 {{CrowdSecInstaller.AccessLogDirectory}} "$t/plugins-storage"
        cat > "$t/compose.yaml" <<'EOF'
        # Traefik for the hotel (written by All-in-1 Installer). Update: docker compose pull && docker compose up -d
        services:
          traefik:
            image: traefik:v3
            container_name: traefik
            restart: unless-stopped
            network_mode: host
            volumes:
              - ./traefik.yml:/etc/traefik/traefik.yml:ro
              - ./dynamic:/etc/traefik/dynamic:ro
              - ./letsencrypt:/letsencrypt
              - ./plugins-storage:/plugins-storage
              - {{CrowdSecInstaller.AccessLogDirectory}}:{{CrowdSecInstaller.AccessLogDirectory}}
        EOF
        """;

    /// <summary>Polaris' own /api paths. With AtomCMS only these go to Polaris because the CMS has its own /api.</summary>
    public static readonly string[] PolarisApiPaths =
        ["auth", "authx", "badges", "cms", "emustats", "health", "housekeeping", "maintenance", "public", "wired"];

    // Writes dynamic/hotel.yml and hotel.env in $t. Traefik picks up the routes without a restart.
    private static string RoutesScript(WebAccessSettings settings)
    {
        string entryPoint = settings.Https ? "websecure" : "web";
        string host = settings.IsIpAddress ? "" : $"Host(`{settings.Address}`) && ";
        string siteRule = settings.IsIpAddress ? "PathPrefix(`/`)" : $"Host(`{settings.Address}`)";
        string tls = settings.Https ? "\n      tls:\n        certResolver: letsencrypt" : "";
        string polaris = settings.HasCms
            ? $"PathPrefix(`/ws`) || PathPrefix(`/nitro-sec`) || PathRegexp(`^/api/({string.Join('|', PolarisApiPaths)})(/|$)`)"
            : "PathPrefix(`/ws`) || PathPrefix(`/api`)";
        string description = settings.CmsOnOwnPort
            ? $"/ws and Polaris' /api paths to Polaris, /client, /gamedata and /custom to the hotel site, the rest to {settings.CmsName} on port {settings.CmsPort}"
            : settings.HasCms ? $"/ws and Polaris' /api paths to Polaris, the rest ({settings.CmsName}, /client) to NGINX" : "/ws and /api to Polaris, the rest to NGINX";
        // With the CMS on its own port, the hotel site keeps Octane (/client) and the assets; the CMS gets the rest.
        string cmsRouter = settings.CmsOnOwnPort ? $$"""

                cms:
                  rule: "{{siteRule}}"
                  entryPoints: [{{entryPoint}}]
                  service: cms
                  priority: 1{{tls}}
            """ : "";
        // Whole folders only: a CMS page such as /customize or /clients stays the CMS'. EpicNext has a page of its own on
        // /client (it loads Octane from /client/), so only /client/ goes to the hotel site there.
        string hotelRule = settings.CmsOnOwnPort
            ? host + "(" + string.Join(" || ", new[] { "client", "gamedata", "custom" }
                .Select(f => f == "client" && settings.EpicNext ? "PathPrefix(`/client/`)" : $"Path(`/{f}`) || PathPrefix(`/{f}/`)")) + ")"
            : siteRule;
        string cmsService = settings.CmsOnOwnPort ? $$"""

                cms:
                  loadBalancer:
                    servers:
                      - url: "http://127.0.0.1:{{settings.CmsPort}}"
            """ : "";
        return $$"""
            echo "> $t/dynamic/hotel.yml: {{settings.Url}}{{description}}"
            cat > "$t/dynamic/hotel.yml" <<'EOF'
            # The hotel's routes (written by All-in-1 Installer).
            http:
              routers:
                polaris:
                  rule: "{{host}}({{polaris}})"
                  entryPoints: [{{entryPoint}}]
                  service: polaris
                  priority: 100{{tls}}
                hotel:
                  rule: "{{hotelRule}}"
                  entryPoints: [{{entryPoint}}]
                  service: nginx
                  priority: {{(settings.CmsOnOwnPort ? 50 : 1)}}{{tls}}{{cmsRouter}}
              services:
                polaris:
                  loadBalancer:
                    servers:
                      - url: "http://127.0.0.1:{{PolarisPort}}"
                nginx:
                  loadBalancer:
                    servers:
                      - url: "http://127.0.0.1:{{NginxPort}}"{{cmsService}}
            EOF

            cat > "$t/hotel.env" <<'EOF'
            ADDRESS={{settings.Address}}
            SCHEME={{settings.Scheme}}
            CLOUDFLARE={{(settings.Cloudflare ? "yes" : "no")}}
            CMS={{(settings.AtomCms ? "atom" : settings.EpicNext ? "epicnext" : settings.CustomCms is not null ? "custom" : "none")}}
            CMS_NAME={{settings.CustomCms ?? ""}}
            CMS_PORT={{(settings.CmsOnOwnPort ? settings.CmsPort.ToString() : "")}}
            EOF
            """;
    }

    /// <summary>Rewrites only the routes, for the CMS addon. Traefik itself keeps running.</summary>
    public static Task ConfigureRoutesAsync(ServerConnection connection, WebAccessSettings settings, Action<string> log,
        CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            t={{TraefikDirectory}}
            [ -d "$t/dynamic" ] || fail "Traefik is not set up in $t. Run the Web access step first."
            {{RoutesScript(settings)}}
            """;
        return RemoteScript.RunAsync(connection, script, log, "Changing the Traefik routes failed", token);
    }

    /// <summary>
    /// NGINX's trusted proxies (<see cref="HotelSite.RealIpFile"/>): 127.0.0.1, and Cloudflare's ranges behind Cloudflare.
    /// Points an older hotel site at the file, then checks and reloads NGINX (no connection is dropped).
    /// </summary>
    public static Task ConfigureNginxRealIpAsync(ServerConnection connection, WebAccessSettings settings, Action<string> log,
        CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + HotelSite.RealIpScript(settings) + $$"""

            nginx -t 2>&1 | sed 's/^/  /'
            nginx -t >/dev/null 2>&1 || fail "nginx -t refuses the configuration (see above)."
            if [ -d /run/systemd/system ]; then systemctl reload nginx; else nginx -s reload; fi
            echo "  NGINX reloaded"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Setting NGINX's visitor address failed", token);
    }

    /// <summary>The weekly refresh of Cloudflare's ranges, at the place and with the name the hotel guides use.</summary>
    public const string CloudflareRefreshScript = "/var/scripts/CF_Refresh.sh";
    public const string CloudflareRefreshCron = "/etc/cron.d/cf-refresh";

    /// <summary>
    /// The refresh script: downloads Cloudflare's ranges and gives them to NGINX (reloaded gracefully), Traefik and
    /// Polaris. Traefik and Polaris only restart when the ranges changed, because a restart briefly drops the players;
    /// Polaris only when it was set up for Cloudflare before (Web access, Harden, or Tools → Fix visitor IPs).
    /// </summary>
    private static string CloudflareRefreshContent() => $$"""
        #!/bin/bash
        # Keeps Cloudflare's IP ranges current for the hotel (written by All-in-1 Installer; weekly from {{CloudflareRefreshCron}}).
        # NGINX, Traefik and Polaris read the visitor's address from X-Forwarded-For past Cloudflare, instead of seeing Cloudflare's.
        set -u
        fail() { echo "ERROR: $*"; exit 1; }
        v4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4) || fail "Could not download Cloudflare's IPv4 ranges: nothing changed."
        v6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6) || fail "Could not download Cloudflare's IPv6 ranges: nothing changed."
        ranges=$(printf '%s\n%s\n' "$v4" "$v6" | grep -E '^[0-9a-f.:]+/[0-9]+$')
        [ "$(echo "$ranges" | grep -c .)" -ge 10 ] || fail "Cloudflare's ranges look wrong: nothing changed."
        echo "$(date '+%F %T') $(echo "$ranges" | grep -c .) Cloudflare ranges"

        # NGINX: the hotel site's trusted proxies. A reload keeps every connection.
        realip={{HotelSite.RealIpFile}}
        { echo "# Proxies NGINX takes the visitor's address from (written by All-in-1 Installer): Traefik and Cloudflare."
          echo "set_real_ip_from 127.0.0.1;"
          echo "$ranges" | sed 's/.*/set_real_ip_from &;/'; } > "$realip.new"
        if ! cmp -s "$realip.new" "$realip"; then
          cp "$realip" "$realip.old" 2>/dev/null || true
          mv "$realip.new" "$realip"
          if nginx -t >/dev/null 2>&1; then
            { [ -d /run/systemd/system ] && systemctl reload nginx; } || nginx -s reload
            echo "  NGINX: updated and reloaded"
          else
            [ -f "$realip.old" ] && mv "$realip.old" "$realip"
            echo "  NGINX: nginx -t refused the new list, the old one is back"
          fi
        else
          rm -f "$realip.new"
          echo "  NGINX: up to date"
        fi

        # Traefik: the entry points trust X-Forwarded-For only from Cloudflare. A restart drops the players for a moment.
        traefik={{TraefikDirectory}}/traefik.yml
        list=$(echo "$ranges" | sed 's/.*/"&"/' | paste -sd, -)
        if [ -f "$traefik" ]; then
          sed -E "s#^([[:space:]]*trustedIPs:).*#\1 [$list]#" "$traefik" > "$traefik.new"
          if ! cmp -s "$traefik.new" "$traefik"; then
            mv "$traefik.new" "$traefik"
            docker restart traefik >/dev/null && echo "  Traefik: updated and restarted"
          else
            rm -f "$traefik.new"
            echo "  Traefik: up to date"
          fi
        fi

        # CrowdSec's bouncer (Addons → CrowdSec) takes the visitor past the same ranges. Traefik reads it again by itself.
        bouncer={{CrowdSecInstaller.MiddlewareFile}}
        if [ -f "$bouncer" ] && grep -q 'forwardedHeadersTrustedIPs:' "$bouncer"; then
          sed -E "s#^([[:space:]]*forwardedHeadersTrustedIPs:).*#\1 [$list]#" "$bouncer" > "$bouncer.new"
          if ! cmp -s "$bouncer.new" "$bouncer"; then
            cat "$bouncer.new" > "$bouncer"
            echo "  CrowdSec bouncer: updated"
          else
            echo "  CrowdSec bouncer: up to date"
          fi
          rm -f "$bouncer.new"
        fi

        # Polaris: the proxies it reads X-Forwarded-For past. Only stopped (and started again) when the list changed:
        # it writes its settings back when it stops, so they cannot be changed while it runs.
        d={{EmulatorInstaller.Directory}}
        log={{EmulatorInstaller.LogDirectory}}/emulator.log
        db=$(grep -sE '^db.database=' "$d/config.ini" | cut -d= -f2)
        if [ -n "$db" ]; then
          want=$(echo "$ranges" | paste -sd, -)
          current=$(mariadb -N "$db" -e "SELECT \`value\` FROM emulator_settings WHERE \`key\` = 'ws.ip.header.trusted'" 2>/dev/null)
          if [ -z "$current" ]; then
            echo "  Polaris: not set up for Cloudflare (Tools → Fix visitor IPs does that)"
          elif [ "$current" = "$want" ]; then
            echo "  Polaris: up to date"
          else
        {{EmulatorInstaller.ControlFunctions}}
            was_running=
            if emulator_running; then was_running=yes; stop_emulator; fi
            mariadb "$db" -e "UPDATE emulator_settings SET \`value\` = '$want' WHERE \`key\` = 'ws.ip.header.trusted'"
            if [ -n "$was_running" ]; then start_emulator; wait_loaded; fi
            echo "  Polaris: updated${was_running:+ and restarted}"
          fi
        fi
        """;

    /// <summary>
    /// Behind Cloudflare: writes <see cref="CloudflareRefreshScript"/> and its weekly cron job (Sunday 04:00) and runs
    /// it once. Without Cloudflare: removes both when this installer wrote them.
    /// </summary>
    public static Task InstallCloudflareRefreshAsync(ServerConnection connection, WebAccessSettings settings, Action<string> log,
        CancellationToken token = default)
    {
        string script = settings.Cloudflare
            ? RemoteScript.Prelude + $$"""
                echo "> {{CloudflareRefreshScript}}: Cloudflare's ranges for NGINX, Traefik and Polaris, weekly from {{CloudflareRefreshCron}}"
                install -d -m 755 /var/scripts
                cat > {{CloudflareRefreshScript}} <<'REFRESH'
                {{CloudflareRefreshContent()}}
                REFRESH
                chmod 755 {{CloudflareRefreshScript}}
                printf '# Cloudflare IP ranges for the hotel (All-in-1 Installer)\n0 4 * * 0 root {{CloudflareRefreshScript}} >> /var/log/cf-refresh.log 2>&1\n' > {{CloudflareRefreshCron}}
                chmod 644 {{CloudflareRefreshCron}}
                echo "  {{CloudflareRefreshCron}}: every Sunday at 04:00, output in /var/log/cf-refresh.log"
                echo "> Running it now"
                {{CloudflareRefreshScript}} | sed 's/^/  /'
                [ "${PIPESTATUS[0]}" = 0 ] || fail "The refresh script failed (see above)."
                """
            : RemoteScript.Prelude + $$"""
                if grep -qs 'All-in-1 Installer' {{CloudflareRefreshScript}}; then
                  rm -f {{CloudflareRefreshScript}} {{CloudflareRefreshCron}}
                  echo "  No Cloudflare: the weekly refresh of Cloudflare's ranges is removed"
                fi
                """;
        return RemoteScript.RunAsync(connection, script, log, "Setting up the Cloudflare refresh failed", token);
    }

    /// <summary>Cloudflare's published IP ranges (IPv4 and IPv6), downloaded on the server.</summary>
    public static async Task<IReadOnlyList<string>> CloudflareRangesAsync(ServerConnection connection, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + """
            load_cloudflare_ranges >/dev/null
            echo "RANGES=$(echo "$ranges" | paste -sd, -)"
            """;
        ScriptValues values = await RemoteScript.RunCapturingAsync(connection, script, _ => { }, "Downloading Cloudflare's IP ranges failed", ["RANGES"], token);
        return (values["RANGES"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    /// <summary>
    /// Polaris reads X-Forwarded-For from right to left and skips only the proxies it trusts. Behind Cloudflare the
    /// header is "visitor, Cloudflare edge" (Traefik adds the edge it saw), so Cloudflare's ranges must be trusted too,
    /// or every player gets a Cloudflare address. Without Cloudflare nothing extra is trusted (127.0.0.1 always is).
    /// </summary>
    public static async Task<string> PolarisTrustedProxiesAsync(ServerConnection connection, WebAccessSettings settings,
        CancellationToken token = default) =>
        settings.Cloudflare ? string.Join(",", await CloudflareRangesAsync(connection, token)) : "";

    /// <summary>
    /// Adds the hotel to ws.whitelist (websocket and CORS origin) and reads the visitor IP from X-Forwarded-For,
    /// trusting Cloudflare's ranges when the site uses Cloudflare. Returns false when the emulator is not installed.
    /// </summary>
    public static async Task<bool> ConfigurePolarisAsync(ServerConnection connection, WebAccessSettings settings, Action<string> log,
        CancellationToken token = default)
    {
        string trusted = await PolarisTrustedProxiesAsync(connection, settings, token);
        string host = HardenInstaller.WhitelistHost(settings);
        string current = await EmulatorInstaller.ReadSettingAsync(connection, "ws.whitelist", token) ?? "";
        var hosts = current.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        if (current != "*" && !hosts.Contains(host, StringComparer.OrdinalIgnoreCase)) hosts.Add(host);
        string whitelist = current == "*" ? "*" : string.Join(',', hosts);
        return await EmulatorInstaller.SetSettingsAsync(connection,
        [
            ("ws.whitelist", whitelist),
            ("websockets.whitelist", whitelist),
            ("ws.ip.header", "X-Forwarded-For"),
            ("ws.ip.header.trusted", trusted)
        ], "websocket whitelist and visitor IP", log, token: token);
    }

    /// <summary>
    /// Checks the site, /api/health and a websocket upgrade through local Traefik. With https, waits up to
    /// 2 minutes for the Let's Encrypt certificate.
    /// </summary>
    public static async Task<WebAccessResult> TestAsync(ServerConnection connection, WebAccessSettings settings, Action<string> log,
        CancellationToken token = default)
    {
        string port = settings.Https ? "443" : "80";
        string name = settings.IsIpAddress ? "hotel.invalid" : settings.Address;
        string origin = settings.Url;
        string script = RemoteScript.Prelude + $$"""
            url="{{settings.Scheme}}://{{name}}"
            # --noproxy because these requests are for this server itself, never for a proxy set in the environment.
            c() { curl -s --noproxy '*' --max-time 10 --resolve "{{name}}:{{port}}:127.0.0.1" --resolve "{{name}}:80:127.0.0.1" "$@"; }
            {{(settings.IsIpAddress ? "c() { curl -s --noproxy '*' --max-time 10 -k \"$@\"; }; url=\"" + settings.Scheme + "://127.0.0.1\"" : "")}}

            cert=no
            if [ "{{settings.Scheme}}" = https ]; then
              echo "> Waiting for the Let's Encrypt certificate for {{name}} (up to 2 minutes)"
              for i in $(seq 1 24); do
                if c -o /dev/null "$url/"; then cert=yes; echo "  certificate is valid after $((i * 5)) seconds"; break; fi
                if docker logs traefik 2>&1 | grep -qiE 'unable to obtain ACME certificate|acme: error'; then break; fi
                sleep 5
              done
              if [ $cert = no ]; then
                problem=$(docker logs traefik 2>&1 | grep -iE 'acme|certificate' | grep -iE 'error|unable' | tail -1 \
                  | sed 's/.*error="//; s/" [A-Za-z][A-Za-z ]*=.*//; s/\\"/"/g' | cut -c1-300)
                # No apostrophe inside ${...:-...}, because bash would take it as an open quote.
                [ -n "$problem" ] || problem="no answer from Let's Encrypt yet"
                echo "CERTPROBLEM=$problem"
                echo "  No valid certificate yet: $problem"
              fi
              echo "CERT=$cert"
              k=-k
            else
              k=
            fi

            echo "> $url/ (NGINX on port {{NginxPort}})"
            code=$(c $k -o /dev/null -w '%{http_code}' "$url/" || true)
            echo "  HTTP $code"
            # AtomCMS answers 302 on a new install to send visitors to its installer.
            case "$code" in 200|302|403) ;; *) fail "Traefik does not pass $url/ to NGINX (HTTP '$code'). See: docker logs traefik" ;; esac
            if [ "{{settings.Scheme}}" = https ]; then
              code=$(c -o /dev/null -w '%{http_code}' "http://{{name}}/" || true)
              case "$code" in
                301|302|307|308) echo "  http://{{name}}/ redirects to https:// (HTTP $code)" ;;
                *) echo "  http://{{name}}/ answers HTTP $code (expected a redirect to https://)" ;;
              esac
            fi

            echo "> $url/api/health (Polaris on port {{PolarisPort}})"
            body=$(c $k -w ' HTTP %{http_code}' "$url/api/health" || true)
            echo "  $body"
            echo "$body" | grep -q 'HTTP 200' && echo "API=yes"

            echo "> $url/ws (websocket upgrade, Origin {{origin}})"
            status=$(c $k --http1.1 -o /dev/null -w '%{http_code}' --max-time 5 \
              -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
              -H 'Sec-WebSocket-Key: SGVsbG8sIGhvdGVsIHRlc3Qh' -H 'Origin: {{origin}}' "$url/ws" || true)
            echo "  HTTP $status"
            [ "$status" = 101 ] && echo "WS=yes"
            true
            """;
        ScriptValues result = await RemoteScript.RunCapturingAsync(connection, script, log, "Testing the web access failed",
            ["CERT", "CERTPROBLEM", "API", "WS"], token);
        return new WebAccessResult(result.Yes("CERT"), result["CERTPROBLEM"], result.Yes("API"), result.Yes("WS"));
    }
}

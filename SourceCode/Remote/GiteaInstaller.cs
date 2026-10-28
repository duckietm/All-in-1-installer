using System.Text.RegularExpressions;

namespace AllInOneInstaller.Remote;

/// <summary>What the Gitea addon asks.</summary>
public sealed record GiteaSettings(string Domain, bool Https, bool Cloudflare, string AdminUser, string AdminEmail)
{
    public string Url => $"{(Https ? "https" : "http")}://{Domain}";
}

/// <summary>What the server has for Gitea before the step runs.</summary>
public sealed record GiteaState(WebAccessSettings? Site, bool DockerRunning, bool TraefikRunning, string? Domain, bool? Cloudflare,
    int Port, bool Running, string? Version)
{
    public bool Installed => Domain is not null && Running;
}

/// <summary>The Gitea addon's result.</summary>
public sealed record GiteaResult(int Port, string? AdminPassword, bool AdminExisted, bool CertificateValid);

/// <summary>
/// Gitea (gitea.com) in Docker behind the hotel's Traefik, on its own domain such as git.example.com, following
/// docs.gitea.com/administration/reverse-proxies. SQLite, its SSH server unpublished (clone over https), its web port on
/// 127.0.0.1 on the first free port from 85 to 95, and a Let's Encrypt certificate through Traefik.
/// </summary>
public static partial class GiteaInstaller
{
    public const string Directory = "/opt/gitea";
    public const string Container = "gitea";
    public const string Image = "gitea/gitea:1";
    public static readonly string RouteFile = WebAccessInstaller.TraefikDirectory + "/dynamic/gitea.yml";

    // Go template braces cannot appear in the $$ raw strings.
    private const string GoRunning = "{{.State.Running}}";
    private const string GoSubnets = "{{range .IPAM.Config}}{{.Subnet}} {{end}}";

    // Names Gitea keeps for itself (models/user: reservedUsernames), the ones someone would pick.
    private static readonly string[] Reserved =
        ["admin", "api", "assets", "avatar", "explore", "ghost", "issues", "login", "new", "notifications", "org", "pulls", "repo", "search", "user"];

    public static string? DomainProblem(string domain, WebAccessSettings? site)
    {
        if (!DomainPattern().IsMatch(domain)) return "Enter a domain name such as git.example.com (letters, digits, '-' and dots).";
        if (site is not null && string.Equals(domain, site.Address, StringComparison.OrdinalIgnoreCase))
            return $"{domain} is the hotel's address: Gitea needs a name of its own, such as git.{site.Address}.";
        return null;
    }

    public static string? UserProblem(string user) =>
        !UserPattern().IsMatch(user) ? "The admin name: letters, digits, '-', '_' and '.', starting with a letter or digit, at most 40."
        : Reserved.Contains(user, StringComparer.OrdinalIgnoreCase) ? $"Gitea keeps the name \"{user}\" for itself: choose another, such as gitadmin."
        : null;

    public static string? EmailProblem(string email) => EmailPattern().IsMatch(email) ? null : "Enter the admin's e-mail address.";

    /// <summary>git.example.com for a hotel on example.com or www.example.com; nothing for a hotel on an IP address.</summary>
    public static string SuggestedDomain(WebAccessSettings? site) =>
        site is null || site.IsIpAddress ? "" : "git." + (site.Address.StartsWith("www.", StringComparison.Ordinal) ? site.Address[4..] : site.Address);

    public static async Task<GiteaState> InspectAsync(ServerConnection connection, CancellationToken token = default)
    {
        string script = $$"""
            [ -f {{WebAccessInstaller.TraefikDirectory}}/hotel.env ] && sed 's/^/conf_/' {{WebAccessInstaller.TraefikDirectory}}/hotel.env
            echo "docker=$(docker info >/dev/null 2>&1 && echo yes)"
            echo "traefik=$(docker inspect -f '{{GoRunning}}' traefik 2>/dev/null)"
            [ -f {{Directory}}/.env ] && sed -n 's/^\(DOMAIN\|CLOUDFLARE\|PORT\)=/gitea_\1=/p' {{Directory}}/.env
            echo "running=$(docker inspect -f '{{GoRunning}}' {{Container}} 2>/dev/null)"
            echo "version=$(docker exec {{Container}} gitea --version 2>/dev/null | awk '{print $3}')"
            """;
        var values = new ScriptValues((await connection.RunAsRootAsync(script, token)).Output);
        return new GiteaState(WebAccessSettings.FromHotelEnv(values), values.Yes("docker"), values["traefik"] == "true",
            values["gitea_DOMAIN"], values["gitea_CLOUDFLARE"] is { } cf ? cf == "yes" : null, values.Int("gitea_PORT"),
            values["running"] == "true", values["version"]);
    }

    /// <summary>
    /// The domain must point at the server before Let's Encrypt can give it a certificate. Fails without an address;
    /// warns when Cloudflare's proxy is off although Cloudflare was chosen, or on although it was not.
    /// </summary>
    public static Task CheckDnsAsync(ServerConnection connection, GiteaSettings settings, Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            d={{settings.Domain}}
            echo "> DNS: $d"
            ips=$(getent ahostsv4 "$d" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd' ' -)
            [ -n "$ips" ] || fail "$d has no address yet. Add an A record for $d with this server's IP address in your DNS{{(settings.Cloudflare ? " (in Cloudflare: proxy on, the orange cloud)" : "")}}, wait a minute and try again."
            echo "  $d points to $ips"
            # In a subshell: without Cloudflare's list (no internet) the check below just has no ranges.
            ranges=$(load_cloudflare_ranges >/dev/null 2>&1 && printf '%s' "$ranges") || ranges=
            behind=$(IPS="$ips" RANGES="$ranges" python3 -c 'import ipaddress, os
            nets = [ipaddress.ip_network(r) for r in os.environ["RANGES"].split()]
            print("yes" if nets and all(any(ipaddress.ip_address(i) in n for n in nets) for i in os.environ["IPS"].split()) else "no")' 2>/dev/null)
            if [ {{(settings.Cloudflare ? "yes" : "no")}} = yes ]; then
              if [ "$behind" = yes ]; then echo "  Cloudflare's proxy is on (the address is Cloudflare's): good"
              elif [ -n "$ranges" ]; then echo "  WARNING: $d does not point to Cloudflare: turn its proxy on (orange cloud) in Cloudflare's DNS, or choose No for Cloudflare."; fi
            else
              [ "$behind" = yes ] && echo "  WARNING: $d points to Cloudflare (proxy on), but Cloudflare is set to No: the visitors' addresses will be Cloudflare's."
              echo "  This server's addresses: $(hostname -I 2>/dev/null) (behind a router or NAT, the A record has the public one)"
            fi
            true
            """;
        return RemoteScript.RunAsync(connection, script, log, "Checking the domain failed", token);
    }

    /// <summary>Writes the compose file, starts Gitea on a free port, adds the Traefik route and creates the admin once.</summary>
    public static async Task<GiteaResult> InstallAsync(ServerConnection connection, GiteaSettings settings, Action<string> log, CancellationToken token = default)
    {
        string entryPoint = settings.Https ? "websecure" : "web";
        string tls = settings.Https ? "\n      tls:\n        certResolver: letsencrypt" : "";
        // Behind Cloudflare, Traefik's X-Real-Ip is Cloudflare's edge: without it Gitea takes the visitor from
        // X-Forwarded-For ("visitor, edge"), two from the end.
        string middleware = settings.Cloudflare ? "\n      middlewares: [gitea-real-ip]" : "";
        string middlewares = settings.Cloudflare ? """

              middlewares:
                gitea-real-ip:
                  headers:
                    customRequestHeaders:
                      X-Real-Ip: ""
            """ : "";
        string script = RemoteScript.Prelude + $$"""
            set -o pipefail
            g={{Directory}}
            docker info >/dev/null 2>&1 || fail "Docker does not run. Run the Web access step first."
            [ -d {{WebAccessInstaller.TraefikDirectory}}/dynamic ] || fail "Traefik is not set up. Run the Web access step first."
            install -d -m 755 "$g"
            install -d -m 750 -o 1000 -g 1000 "$g/data"

            {{LocalPorts.Functions}}
            self_container={{Container}}
            pick_port "$(sed -n 's/^PORT=//p' "$g/.env" 2>/dev/null)"
            echo "> Gitea on 127.0.0.1:$port"

            # Gitea's own proxies: 127.0.0.1 and, once its network exists, the Docker network Traefik reaches it through.
            trusted=$(sed -n 's/^TRUSTED=//p' "$g/.env" 2>/dev/null) || trusted=
            write_env() {
              cat > "$g/.env" <<EOF
            # Gitea (written by All-in-1 Installer, Addons → Gitea).
            DOMAIN={{settings.Domain}}
            ROOT_URL={{settings.Url}}/
            CLOUDFLARE={{(settings.Cloudflare ? "yes" : "no")}}
            PORT=$port
            TRUSTED=${trusted:-127.0.0.0/8,::1/128}
            LIMIT={{(settings.Cloudflare ? 2 : 1)}}
            EOF
              chmod 600 "$g/.env"
            }
            write_env
            echo "> $g/compose.yaml"
            cat > "$g/compose.yaml" <<'EOF'
            # Gitea for the hotel (written by All-in-1 Installer). Update: docker compose pull && docker compose up -d
            # Its own network, not the host's: the image always starts an SSH server (port 22 inside), which must not
            # meet the server's SSH. Only the web port is published, on 127.0.0.1, for Traefik.
            services:
              gitea:
                image: {{Image}}
                container_name: {{Container}}
                restart: unless-stopped
                networks: [gitea]
                ports:
                  - "127.0.0.1:${PORT}:3000"
                environment:
                  - USER_UID=1000
                  - USER_GID=1000
                  - GITEA__server__DOMAIN=${DOMAIN}
                  - GITEA__server__ROOT_URL=${ROOT_URL}
                  - GITEA__server__HTTP_PORT=3000
                  - GITEA__server__DISABLE_SSH=true
                  - GITEA__server__START_SSH_SERVER=false
                  - GITEA__database__DB_TYPE=sqlite3
                  - GITEA__security__INSTALL_LOCK=true
                  - GITEA__security__REVERSE_PROXY_TRUSTED_PROXIES=${TRUSTED}
                  - GITEA__security__REVERSE_PROXY_LIMIT=${LIMIT}
                  - GITEA__service__DISABLE_REGISTRATION=true
                volumes:
                  - ./data:/data
                  - /etc/timezone:/etc/timezone:ro
                  - /etc/localtime:/etc/localtime:ro
            networks:
              gitea:
                name: gitea
            EOF

            echo "> docker compose pull ({{Image}})"
            pulled=
            for i in 1 2 3; do
              if docker compose -f "$g/compose.yaml" pull -q 2>"$g/pull.log"; then pulled=yes; break; fi
              tail -1 "$g/pull.log" | sed 's/^/  /'
              [ $i -lt 3 ] && { echo "  Trying again in $((i * 20)) seconds ..."; sleep $((i * 20)); }
            done
            rm -f "$g/pull.log"
            if [ -z "$pulled" ]; then
              docker image inspect {{Image}} >/dev/null 2>&1 || fail "Could not download the Gitea image from Docker Hub (see above). Try again later."
              echo "  Docker Hub did not answer: using the {{Image}} image that is already on this server"
            fi
            echo "> docker compose up -d"
            docker compose -f "$g/compose.yaml" up -d 2>&1 | grep -v '^ *$'
            subnets=$(docker network inspect gitea -f '{{GoSubnets}}' 2>/dev/null | xargs | tr ' ' ',')
            if [ -n "$subnets" ] && [ "$trusted" != "127.0.0.0/8,::1/128,$subnets" ]; then
              trusted="127.0.0.0/8,::1/128,$subnets"
              write_env
              echo "  Gitea trusts the proxy headers from 127.0.0.1 and its Docker network ($subnets)"
              docker compose -f "$g/compose.yaml" up -d 2>&1 | grep -v '^ *$'
            fi
            for i in $(seq 1 60); do
              curl -fs --noproxy '*' --max-time 3 "http://127.0.0.1:$port/api/healthz" >/dev/null 2>&1 && break
              sleep 2
            done
            curl -fs --noproxy '*' --max-time 3 "http://127.0.0.1:$port/api/healthz" >/dev/null 2>&1 ||
              { docker logs --tail 20 {{Container}} 2>&1 | sed 's/^/  /'; fail "Gitea does not answer on 127.0.0.1:$port (see its log above)."; }
            echo "  $(docker exec {{Container}} gitea --version 2>/dev/null | awk '{print "Gitea " $3}') answers"

            echo "> {{RouteFile}}: {{settings.Url}} to Gitea"
            cat > {{RouteFile}} <<EOF
            # Gitea (written by All-in-1 Installer, Addons → Gitea). Traefik picks it up without a restart.
            http:
              routers:
                gitea:
                  rule: "Host(\`{{settings.Domain}}\`)"
                  entryPoints: [{{entryPoint}}]
                  service: gitea{{middleware}}{{tls}}{{middlewares}}
              services:
                gitea:
                  loadBalancer:
                    servers:
                      - url: "http://127.0.0.1:$port"
            EOF

            # The admin, once: the first run creates it with a random password; later runs keep the users.
            if docker exec -u git {{Container}} gitea admin user list --admin 2>/dev/null | awk 'NR > 1' | grep -q .; then
              echo "> Gitea has an admin already: kept"
              echo "ADMIN=existed"
            else
              echo "> Creating the admin {{settings.AdminUser}}"
              out=$(docker exec -u git {{Container}} gitea admin user create --admin --username {{ServerConnection.ShellQuote(settings.AdminUser)}} \
                --email {{ServerConnection.ShellQuote(settings.AdminEmail)}} --random-password --must-change-password=false 2>&1) ||
                { echo "$out" | sed 's/^/  /'; fail "Creating the admin failed (see above)."; }
              echo "  $(echo "$out" | grep -i 'successfully created' | tail -1)"
              echo "PASSWORD=$(echo "$out" | sed -n "s/.*generated random password is '\(.*\)'.*/\1/p")"
            fi
            echo "PORT=$port"
            """;
        ScriptValues values = await RemoteScript.RunCapturingAsync(connection, script, log, "Installing Gitea failed", ["PORT", "PASSWORD", "ADMIN"], token);
        return new GiteaResult(values.Int("PORT"), values["PASSWORD"], values["ADMIN"] == "existed", false);
    }

    /// <summary>Through Traefik: waits up to 2 minutes for the certificate with https, then checks Gitea's health.</summary>
    public static async Task<bool> TestAsync(ServerConnection connection, GiteaSettings settings, Action<string> log, CancellationToken token = default)
    {
        string port = settings.Https ? "443" : "80";
        string script = RemoteScript.Prelude + $$"""
            url={{settings.Url}}
            c() { curl -s --noproxy '*' --max-time 10 --resolve "{{settings.Domain}}:{{port}}:127.0.0.1" "$@"; }
            cert=no
            if [ {{(settings.Https ? "yes" : "no")}} = yes ]; then
              echo "> Waiting for the Let's Encrypt certificate for {{settings.Domain}} (up to 2 minutes)"
              for i in $(seq 1 24); do
                if c -o /dev/null "$url/"; then cert=yes; echo "  certificate is valid after $((i * 5)) seconds"; break; fi
                sleep 5
              done
              [ $cert = yes ] || echo "  No valid certificate yet: check the A record of {{settings.Domain}}, then docker logs traefik"
              k=-k
            else
              cert=yes
              k=
            fi
            echo "> $url/api/healthz (through Traefik)"
            body=$(c $k "$url/api/healthz" || true)
            echo "$body" | grep -q '"status": *"pass"' || fail "Traefik does not pass $url to Gitea: $(echo "$body" | head -c 200)"
            echo "  Gitea is healthy"
            echo "CERT=$cert"
            """;
        ScriptValues values = await RemoteScript.RunCapturingAsync(connection, script, log, "Testing Gitea failed", ["CERT"], token);
        return values.Yes("CERT");
    }

    [GeneratedRegex("^(?=.{4,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$")]
    private static partial Regex DomainPattern();

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$")]
    private static partial Regex UserPattern();

    [GeneratedRegex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")]
    private static partial Regex EmailPattern();
}

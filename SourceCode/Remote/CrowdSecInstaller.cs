using System.Text.RegularExpressions;

namespace AllInOneInstaller.Remote;

/// <summary>What the CrowdSec addon asks: the console's enrollment key (empty on a rerun keeps the enrollment), a name, the whitelist.</summary>
public sealed record CrowdSecSettings(string EnrollKey, string InstanceName, IReadOnlyList<string> Whitelist);

/// <summary>What the server has for CrowdSec before the step runs.</summary>
public sealed record CrowdSecState(
    WebAccessSettings? Site,
    bool DockerRunning,
    bool TraefikRunning,
    bool Installed,
    bool Running,
    bool BouncerConfigured,
    bool Enrolled,
    string? Version,
    string? InstanceName,
    int Port,
    IReadOnlyList<string> Whitelist,
    IReadOnlyList<string> Banned,
    string? DnsAddresses,
    bool? DnsBehindCloudflare,
    string? ClientIp)
{
    public bool IsComplete => Installed && Running && BouncerConfigured && Enrolled;
}

/// <summary>The bouncer pulled the ban list from CrowdSec, and CrowdSec reads Traefik's access log.</summary>
public sealed record CrowdSecResult(bool BouncerConnected, bool LogRead);

/// <summary>
/// CrowdSec (crowdsec.net) in Docker next to the hotel's Traefik: the security engine reads Traefik's access log, bans
/// addresses that attack the site (scans, probing, known CVEs, brute force) and shares them with the community; its
/// blocklist comes back. Traefik's bouncer plugin (github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin) answers 403
/// to banned addresses on every route. Behind Cloudflare the plugin takes the visitor from X-Forwarded-For past
/// Cloudflare's ranges, as Traefik does. The engine is enrolled in the CrowdSec console (app.crowdsec.net) with the key
/// from there.
/// </summary>
public static partial class CrowdSecInstaller
{
    public const string Directory = "/opt/crowdsec";
    public const string Container = "crowdsec";
    public const string Image = "crowdsecurity/crowdsec:latest";
    public const string ConsoleUrl = "https://app.crowdsec.net";
    public const string BouncerName = "traefik";
    public const string AllowlistName = "all-in-1";
    public const string Middleware = "crowdsec";
    public const string Plugin = "crowdsec";
    public const string PluginModule = "github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin";
    public const string PluginVersion = "v1.8.1";
    public const string AccessLogDirectory = "/var/log/traefik";
    public const string AccessLog = AccessLogDirectory + "/access.log";
    public static readonly string MiddlewareFile = WebAccessInstaller.TraefikDirectory + "/dynamic/crowdsec.yml";
    public const string Collections = "crowdsecurity/traefik crowdsecurity/http-cve crowdsecurity/whitelist-good-actors";

    // The hotel's own files: a room loads hundreds of furniture files at once, which would look like a crawler.
    private static readonly string[] AssetPaths = ["/gamedata/", "/client/", "/custom/", "/swf/", "/nitro-assets/", "/_next/static/", "/assets/"];

    // Go template braces cannot appear in the $$ raw strings.
    private const string GoRunning = "{{.State.Running}}";

    /// <summary>
    /// The enrollment key from a paste: the key alone, or the whole command the console shows
    /// ("sudo cscli console enroll -e context cm1abc..."). Null when there is none.
    /// </summary>
    public static string? KeyFrom(string text)
    {
        string? key = text.Split([' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Where(word => !word.StartsWith('-')).LastOrDefault()?.Trim('"', '\'');
        return key is not null && KeyPattern().IsMatch(key) ? key : null;
    }

    public static string? KeyProblem(string text, bool enrolled) =>
        text.Trim().Length == 0
            ? enrolled ? null : "Paste the enrollment key from the CrowdSec console (see 1 and 2 above): it is required."
            : KeyFrom(text) is null ? "That is not an enrollment key: copy the key (or the whole cscli console enroll command) from app.crowdsec.net." : null;

    public static string? NameProblem(string name) =>
        NamePattern().IsMatch(name) ? null : "The name in the console: letters, digits, '.', '-' and '_', at most 64.";

    public static async Task<CrowdSecState> InspectAsync(ServerConnection connection, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude.Replace("set -e\n", "") + $$"""
            [ -f {{WebAccessInstaller.TraefikDirectory}}/hotel.env ] && sed 's/^/conf_/' {{WebAccessInstaller.TraefikDirectory}}/hotel.env
            echo "docker=$(docker info >/dev/null 2>&1 && echo yes)"
            echo "traefik=$(docker inspect -f '{{GoRunning}}' traefik 2>/dev/null)"
            c={{Directory}}
            [ -f $c/.env ] && sed -n 's/^\(LAPI_PORT\|ENROLLED\|INSTANCE\|WHITELIST\)=/cs_\1=/p' $c/.env
            echo "installed=$([ -f $c/compose.yaml ] && echo yes)"
            echo "bouncer=$([ -f {{MiddlewareFile}} ] && echo yes)"
            echo "running=$(docker inspect -f '{{GoRunning}}' {{Container}} 2>/dev/null)"
            if [ "$(docker inspect -f '{{GoRunning}}' {{Container}} 2>/dev/null)" = true ]; then
              echo "version=$(docker exec {{Container}} cscli version 2>&1 | awk '/^version:/ {print $2}' | cut -d- -f1)"
              # Local bans only (not the community blocklist): what this server decided, or someone by hand.
              echo "banned=$(docker exec {{Container}} cscli decisions list -o json 2>/dev/null | python3 -c 'import json, sys
            d = json.load(sys.stdin) or []
            print(" ".join(sorted({x["value"] for a in d for x in (a.get("decisions") or []) if x.get("scope", "").lower() in ("ip", "range")})))' 2>/dev/null)"
            fi
            # Is the hotel's domain behind Cloudflare's proxy (its address one of Cloudflare's)?
            a=$(sed -n 's/^ADDRESS=//p' {{WebAccessInstaller.TraefikDirectory}}/hotel.env 2>/dev/null)
            if [ -n "$a" ] && ! echo "$a" | grep -qE '^[0-9.]+$|:'; then
              ips=$(getent ahostsv4 "$a" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd' ' -)
              echo "dns=$ips"
              if [ -n "$ips" ]; then
                ranges=$(load_cloudflare_ranges >/dev/null 2>&1 && printf '%s' "$ranges") || ranges=
                [ -n "$ranges" ] && echo "dnscf=$(IPS="$ips" RANGES="$ranges" python3 -c 'import ipaddress, os
            nets = [ipaddress.ip_network(r) for r in os.environ["RANGES"].split()]
            print("yes" if all(any(ipaddress.ip_address(i) in n for n in nets) for i in os.environ["IPS"].split()) else "no")' 2>/dev/null)"
              fi
            fi
            """;
        var values = new ScriptValues((await connection.RunAsRootAsync(script, token)).Output);
        string? clientIp = null;
        try
        {
            string output = (await connection.RunAsync("echo \"client=${SSH_CLIENT%% *}\"", token)).Output;
            clientIp = new ScriptValues(output)["client"] is { } ip && Fail2BanInstaller.EntryProblem(ip) is null ? ip : null;
        }
        catch (ServerConnectionException)
        {
        }
        return new CrowdSecState(WebAccessSettings.FromHotelEnv(values), values.Yes("docker"), values["traefik"] == "true",
            values.Yes("installed"), values["running"] == "true", values.Yes("bouncer"), values.Yes("cs_ENROLLED"), values["version"],
            values["cs_INSTANCE"], values.Int("cs_LAPI_PORT"),
            (values["cs_WHITELIST"] ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries),
            (values["banned"] ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries),
            values["dns"], values["dnscf"] is { } cf ? cf == "yes" : null, clientIp);
    }

    /// <summary>
    /// Why CrowdSec cannot be set up (yet), or null. Behind Cloudflare without Traefik trusting Cloudflare, every visitor
    /// would look like one of Cloudflare's addresses: a ban would shut out everyone behind that address.
    /// </summary>
    public static string? Problem(CrowdSecState state) =>
        state.Site is null ? "Run the Web access step first: CrowdSec works with its Docker and Traefik."
        : !state.DockerRunning ? "Docker does not run: run the Web access step first."
        : !state.TraefikRunning ? "Traefik does not run: run the Web access step first."
        : state.DnsBehindCloudflare == true && !state.Site.Cloudflare
            ? $"{state.Site.Address} points to Cloudflare (proxy on), but Web access was set up without Cloudflare. Traefik then sees Cloudflare's addresses " +
              "instead of the visitors', and CrowdSec would ban Cloudflare (everyone). Run Install New Server → Web access again and choose Yes for Cloudflare, then this addon."
        : null;

    /// <summary>The engine: compose file, acquisition of Traefik's log, the hotel assets filter, start, and the whitelist.</summary>
    public static Task InstallEngineAsync(ServerConnection connection, CrowdSecSettings settings, Action<string> log, CancellationToken token = default)
    {
        string assets = string.Join(" || ", AssetPaths.Select(p => $"evt.Meta.http_path startsWith '{p}'"));
        string script = RemoteScript.Prelude + $$"""
            set -o pipefail
            c={{Directory}}
            docker info >/dev/null 2>&1 || fail "Docker does not run. Run the Web access step first."
            install -d -m 755 "$c" "$c/config" "$c/data" "$c/parsers" {{AccessLogDirectory}}
            touch {{AccessLog}}

            # The port CrowdSec's API listens on for the bouncer (127.0.0.1 only): kept, or the first free one from 8080.
            port=$(sed -n 's/^LAPI_PORT=//p' "$c/.env" 2>/dev/null) || port=
            if [ -z "$port" ]; then
              for p in $(seq 8080 8099); do ss -Hltn "sport = :$p" | grep -q . || { port=$p; break; }; done
              [ -n "$port" ] || fail "Ports 8080 to 8099 are all in use: free one for CrowdSec's API."
            fi
            # The bouncer's key: made once, at random; CrowdSec registers it at every start (BOUNCER_KEY_traefik).
            key=$(sed -n 's/^BOUNCER_KEY=//p' "$c/.env" 2>/dev/null) || key=
            [ -n "$key" ] || key=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
            enrolled=$(sed -n 's/^ENROLLED=//p' "$c/.env" 2>/dev/null) || enrolled=
            umask 077
            cat > "$c/.env" <<EOF
            # CrowdSec (written by All-in-1 Installer, Addons → CrowdSec).
            LAPI_PORT=$port
            BOUNCER_KEY=$key
            INSTANCE={{settings.InstanceName}}
            WHITELIST={{string.Join(' ', settings.Whitelist)}}
            ENROLLED=$enrolled
            EOF
            umask 022
            echo "> $c/.env: CrowdSec's API on 127.0.0.1:$port"

            cat > "$c/acquis.yaml" <<'EOF'
            # What CrowdSec reads (written by All-in-1 Installer): Traefik's access log, every request to the hotel.
            filenames:
              - {{AccessLog}}
            labels:
              type: traefik
            EOF

            cat > "$c/parsers/hotel-assets.yaml" <<'EOF'
            # The hotel's own files are not suspicious (written by All-in-1 Installer): a room loads hundreds of furniture
            # files at once, and missing ones answer 404. Without this, players would look like crawlers or scanners.
            name: all-in-1/hotel-assets
            description: "Requests for the hotel's assets (gamedata, client) are never counted"
            whitelist:
              reason: "hotel assets"
              expression:
                - "{{assets}}"
            EOF

            cat > "$c/compose.yaml" <<'EOF'
            # CrowdSec for the hotel (written by All-in-1 Installer). Update: docker compose pull && docker compose up -d
            services:
              crowdsec:
                image: {{Image}}
                container_name: {{Container}}
                restart: unless-stopped
                environment:
                  COLLECTIONS: "{{Collections}}"
                  BOUNCER_KEY_{{BouncerName}}: ${BOUNCER_KEY}
                ports:
                  - "127.0.0.1:${LAPI_PORT}:8080"
                volumes:
                  - ./acquis.yaml:/etc/crowdsec/acquis.yaml:ro
                  - ./parsers/hotel-assets.yaml:/etc/crowdsec/parsers/s02-enrich/all-in-1-hotel-assets.yaml:ro
                  - ./config:/etc/crowdsec
                  - ./data:/var/lib/crowdsec/data
                  - {{AccessLogDirectory}}:{{AccessLogDirectory}}:ro
            EOF
            echo "> $c/compose.yaml ({{Image}}): collections {{Collections}}"

            # Traefik's access log grows with every request: daily, a week kept.
            cat > /etc/logrotate.d/traefik-access <<'EOF'
            {{AccessLog}} {
              daily
              rotate 7
              compress
              delaycompress
              missingok
              notifempty
              copytruncate
            }
            EOF

            echo "> docker compose pull"
            pulled=
            for i in 1 2 3; do
              if compose_in "$c" pull -q 2>"$c/pull.log"; then pulled=yes; break; fi
              tail -1 "$c/pull.log" | sed 's/^/  /'
              [ $i -lt 3 ] && { echo "  Trying again in $((i * 20)) seconds ..."; sleep $((i * 20)); }
            done
            rm -f "$c/pull.log"
            if [ -z "$pulled" ]; then
              docker image inspect {{Image}} >/dev/null 2>&1 || fail "Could not download the CrowdSec image from Docker Hub (see above). Try again later."
              echo "  Docker Hub did not answer: using the image that is already on this server"
            fi
            echo "> docker compose up -d"
            compose_in "$c" up -d 2>&1 | grep -v '^ *$'
            # The first start downloads the collections from CrowdSec's hub: up to a few minutes.
            echo "  Waiting for CrowdSec's API ..."
            ok=
            for i in $(seq 1 90); do
              [ "$(docker inspect -f '{{GoRunning}}' {{Container}} 2>/dev/null)" = true ] || { [ $i -gt 10 ] && break; }
              docker exec {{Container}} cscli lapi status >/dev/null 2>&1 && { ok=yes; break; }
              sleep 2
            done
            [ -n "$ok" ] || { docker logs --tail 25 {{Container}} 2>&1 | sed 's/^/  /'; fail "CrowdSec does not start (see its log above)."; }
            echo "  CrowdSec $(docker exec {{Container}} cscli version 2>&1 | awk '/^version:/ {print $2}') runs"
            docker exec {{Container}} cscli collections list -o raw 2>/dev/null | awk -F, 'NR > 1 {print "  collection " $1 " (" $2 ")"}'
            docker exec {{Container}} cscli bouncers list -o raw 2>/dev/null | grep -q '^{{BouncerName}},' || fail "CrowdSec did not register the bouncer key (see: docker logs crowdsec)."

            {{AllowlistScript(settings.Whitelist)}}
            """;
        return RemoteScript.RunAsync(connection, script, log, "Installing CrowdSec failed", token);
    }

    // The whitelist as CrowdSec's allowlist: never banned, also not by the community blocklist. Bans of whitelisted
    // addresses are lifted.
    private static string AllowlistScript(IReadOnlyList<string> whitelist)
    {
        string entries = string.Join(' ', whitelist.Select(ServerConnection.ShellQuote));
        return $$"""
            cs() { docker exec {{Container}} cscli "$@"; }
            cs allowlists delete {{AllowlistName}} >/dev/null 2>&1 || true
            cs allowlists create {{AllowlistName}} -d "Never banned (All-in-1 Installer)" >/dev/null || fail "Could not make CrowdSec's allowlist."
            for e in {{entries}}; do
              cs allowlists add {{AllowlistName}} "$e" >/dev/null || fail "CrowdSec does not take $e for the allowlist."
              case "$e" in */*) cs decisions delete -r "$e" >/dev/null 2>&1 ;; *) cs decisions delete -i "$e" >/dev/null 2>&1 ;; esac
            done
            echo "  whitelist: {{(whitelist.Count == 0 ? "(empty)" : string.Join(' ', whitelist))}}"
            """;
    }

    /// <summary>Enrolls the engine in the CrowdSec console. The owner of the account then accepts it on app.crowdsec.net.</summary>
    public static Task EnrollAsync(ServerConnection connection, string key, string name, Action<string> log, CancellationToken token = default)
    {
        if (KeyFrom(key) is not { } clean) throw new ServerConnectionException("That is not an enrollment key.");
        string script = RemoteScript.Prelude + $$"""
            c={{Directory}}
            echo "> cscli console enroll --name {{name}}"
            out=$(docker exec {{Container}} cscli console enroll --overwrite --name {{ServerConnection.ShellQuote(name)}} {{clean}} 2>&1) && status=0 || status=$?
            echo "$out" | sed 's/^/  /' | grep -v '^ *$'
            if [ $status -ne 0 ] || echo "$out" | grep -qiE 'level=(error|fatal)|could not enroll|not valid|invalid'; then
              why=$(echo "$out" | grep -iE 'error|fatal|not valid|invalid' | tail -1 | sed -E 's/.*(Error|error|fatal)[:=] *//; s/^"//; s/"$//')
              fail "The CrowdSec console did not take the key (${why:-see above}). Copy it again from app.crowdsec.net (Security Engines → Enroll): a key can expire."
            fi
            sed -i 's/^ENROLLED=.*/ENROLLED=yes/' "$c/.env"
            # Restarting CrowdSec makes it send its enrollment request to the console now.
            docker restart {{Container}} >/dev/null
            for i in $(seq 1 30); do docker exec {{Container}} cscli lapi status >/dev/null 2>&1 && break; sleep 2; done
            echo "  Enrolled: accept \"{{name}}\" on {{ConsoleUrl}}"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Enrolling in the CrowdSec console failed", token);
    }

    // The bouncer middleware: Traefik's dynamic configuration, read again without a restart. Stream mode keeps the ban
    // list in memory (no question to CrowdSec per request). When CrowdSec cannot be reached the hotel stays reachable
    // (updateMaxFailure -1), and Traefik does not wait for CrowdSec when it starts (streamStartupBlock false).
    private static string MiddlewareScript(int port, IReadOnlyList<string> whitelist, bool cloudflare)
    {
        string trusted = string.Join(", ", new[] { "127.0.0.1/32" }.Concat(whitelist).Select(e => $"\"{e}\""));
        return $$"""
            key=$(sed -n 's/^BOUNCER_KEY=//p' {{Directory}}/.env)
            [ -n "$key" ] || fail "CrowdSec's bouncer key is missing in {{Directory}}/.env: run this addon again."
            cfline=
            if [ {{(cloudflare ? "yes" : "no")}} = yes ]; then
              load_cloudflare_ranges
              cfline="          forwardedHeadersTrustedIPs: [$(echo "$ranges" | sed 's/.*/"&"/' | paste -sd, -)]"
            fi
            umask 077
            cat > {{MiddlewareFile}} <<EOF
            # CrowdSec's bouncer on every route (written by All-in-1 Installer, Addons → CrowdSec; Tools → CrowdSec).
            http:
              middlewares:
                {{Middleware}}:
                  plugin:
                    {{Plugin}}:
                      enabled: true
                      logLevel: INFO
                      crowdsecMode: stream
                      updateIntervalSeconds: 60
                      updateMaxFailure: -1
                      streamStartupBlock: false
                      crowdsecLapiScheme: http
                      crowdsecLapiHost: "127.0.0.1:{{port}}"
                      crowdsecLapiKey: "$key"
                      remediationHeadersCustomName: X-Crowdsec-Remediation
                      clientTrustedIPs: [{{trusted}}]
            $cfline
            EOF
            umask 022
            sed -i '/^$/d' {{MiddlewareFile}}
            echo "> {{MiddlewareFile}}{{(cloudflare ? ": visitors from X-Forwarded-For past Cloudflare's ranges" : "")}}"
            """;
    }

    // The HTTP code and Server header of the hotel's start page through local Traefik ("200 nginx"): a broken route is
    // Traefik's own 404, without NGINX's header.
    private static string ProbeFunction(WebAccessSettings site) => $$"""
        probe() {
          if [ {{(site.Https ? "yes" : "no")}} = yes ]; then
            curl -sk -D - -o /dev/null --max-time 15 --resolve '{{site.Address}}:443:127.0.0.1' 'https://{{site.Address}}/' 2>/dev/null
          else
            curl -s -D - -o /dev/null --max-time 15 -H 'Host: {{site.Address}}' http://127.0.0.1/ 2>/dev/null
          fi | tr -d '\r' | awk 'NR == 1 {c = $2} tolower($1) == "server:" {s = $2} END {print (c ? c : "000") (s ? " " s : "")}'
        }
        """;

    /// <summary>
    /// Puts the bouncer in front of every route: the middleware, Traefik's static configuration with the plugin and the
    /// access log, and a new Traefik container. When the site stops answering as before, the previous configuration
    /// comes back.
    /// </summary>
    public static Task ConfigureTraefikAsync(ServerConnection connection, WebAccessSettings site, IReadOnlyList<string> whitelist,
        Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            t={{WebAccessInstaller.TraefikDirectory}}
            [ -f "$t/traefik.yml" ] || fail "Traefik is not set up in $t. Run the Web access step first."
            port=$(sed -n 's/^LAPI_PORT=//p' {{Directory}}/.env)
            {{ProbeFunction(site)}}
            before=$(probe)
            echo "> The hotel through Traefik now: HTTP $before"
            for f in traefik.yml compose.yaml; do cp -p "$t/$f" "$t/$f.before-crowdsec"; done
            had_middleware=$([ -f {{MiddlewareFile}} ] && echo yes || true)
            [ -n "$had_middleware" ] && cp -p {{MiddlewareFile}} "$t/crowdsec.yml.before"

            {{MiddlewareScript(0, whitelist, site.Cloudflare).Replace("127.0.0.1:0", "127.0.0.1:$port")}}
            {{WebAccessInstaller.StaticConfigScript(site)}}
            {{WebAccessInstaller.ComposeScript()}}

            restore() {
              echo "  Putting the previous Traefik configuration back ..."
              for f in traefik.yml compose.yaml; do mv -f "$t/$f.before-crowdsec" "$t/$f"; done
              if [ -n "$had_middleware" ]; then mv -f "$t/crowdsec.yml.before" {{MiddlewareFile}}; else rm -f {{MiddlewareFile}}; fi
              compose_in "$t" up -d --force-recreate >/dev/null 2>&1
            }
            # From here on a failure puts the previous configuration back first.
            fail() { restore; echo "ERROR: $* The previous Traefik configuration is back."; exit 1; }
            started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
            echo "> Restarting Traefik with the bouncer (players are disconnected for a moment)"
            compose_in "$t" up -d --force-recreate 2>&1 | grep -v '^ *$'
            {{WebAccessInstaller.WaitForTraefikScript}}
            # Traefik downloads the plugin (plugins.traefik.io) when it starts.
            sleep 5
            after=
            for i in $(seq 1 15); do after=$(probe); [ "$after" = "$before" ] && break; sleep 2; done
            problem=$(docker logs --since "$started" traefik 2>&1 | grep -iE 'plugin|crowdsec' | grep -iE 'error|fail|unable|disabled' | tail -3)
            if [ -n "$problem" ] || [ "$after" != "$before" ]; then
              [ -n "$problem" ] && echo "$problem" | sed 's/^/  /'
              echo "$problem" | grep -q 'unable to download plugin' &&
                echo "  Traefik could not download the plugin from plugins.traefik.io: the server needs to reach it (internet, DNS, an outgoing firewall)."
              echo "  The hotel answers HTTP $after (before: $before)"
              fail "Traefik does not work with the CrowdSec plugin (see above), so the hotel runs as before."
            fi
            rm -f "$t/traefik.yml.before-crowdsec" "$t/compose.yaml.before-crowdsec" "$t/crowdsec.yml.before"
            echo "  The hotel answers HTTP $after, as before: the bouncer is in front of every route"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Adding the CrowdSec bouncer to Traefik failed", token);
    }

    /// <summary>Waits until the bouncer has pulled the ban list, and checks that CrowdSec reads Traefik's access log.</summary>
    public static async Task<CrowdSecResult> TestAsync(ServerConnection connection, WebAccessSettings site, Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            {{ProbeFunction(site)}}
            probe >/dev/null
            echo "> Waiting for the bouncer to fetch the ban list (once a minute) ..."
            pulled=
            for i in $(seq 1 45); do
              pulled=$(docker exec {{Container}} cscli bouncers list -o json 2>/dev/null | python3 -c 'import json, sys
            for b in json.load(sys.stdin) or []:
                if b.get("name") == "{{BouncerName}}" and b.get("last_pull"): print(b["last_pull"])' 2>/dev/null)
              [ -n "$pulled" ] && break
              sleep 2
            done
            if [ -n "$pulled" ]; then echo "  The bouncer fetched the ban list at $pulled"; echo "BOUNCER=yes"
            else echo "  The bouncer has not fetched the ban list yet: see Debug → Traefik for crowdsec lines"; fi
            probe >/dev/null
            sleep 3
            # "│ file:/var/log/traefik/access.log │ 12 │ 12 │ - │ - │": the first number is the lines read.
            read=$(docker exec {{Container}} cscli metrics show acquisition 2>/dev/null | grep 'access.log' | sed 's/.*access\.log//' | grep -oE '[0-9]+' | head -1)
            echo "  CrowdSec read ${read:-0} line(s) of {{AccessLog}} so far"
            [ "${read:-0}" -gt 0 ] 2>/dev/null && echo "LOGREAD=yes"
            true
            """;
        ScriptValues values = await RemoteScript.RunCapturingAsync(connection, script, log, "Testing CrowdSec failed", ["BOUNCER", "LOGREAD"], token);
        return new CrowdSecResult(values.Yes("BOUNCER"), values.Yes("LOGREAD"));
    }

    /// <summary>A new whitelist: CrowdSec's allowlist and the bouncer's trusted addresses (Traefik reads that without a restart).</summary>
    public static Task SaveWhitelistAsync(ServerConnection connection, WebAccessSettings site, int port, IReadOnlyList<string> whitelist,
        Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            [ "$(docker inspect -f '{{GoRunning}}' {{Container}} 2>/dev/null)" = true ] || fail "CrowdSec does not run: run Addons → CrowdSec first."
            {{AllowlistScript(whitelist)}}
            sed -i 's#^WHITELIST=.*#WHITELIST={{string.Join(' ', whitelist)}}#' {{Directory}}/.env
            if [ -f {{MiddlewareFile}} ]; then
            {{MiddlewareScript(port, whitelist, site.Cloudflare)}}
            fi
            """;
        return RemoteScript.RunAsync(connection, script, log, "Saving CrowdSec's whitelist failed", token);
    }

    /// <summary>Lifts a ban (an address or a range).</summary>
    public static Task UnbanAsync(ServerConnection connection, string value, Action<string> log, CancellationToken token = default)
    {
        if (Fail2BanInstaller.EntryProblem(value) is { } problem) throw new ServerConnectionException(problem);
        string flag = value.Contains('/') ? "-r" : "-i";
        string script = RemoteScript.Prelude + $$"""
            echo "> cscli decisions delete {{flag}} {{value}}"
            docker exec {{Container}} cscli decisions delete {{flag}} {{ServerConnection.ShellQuote(value)}} 2>&1 | sed 's/^/  /' | grep -v '^ *$' || true
            echo "  {{value}} can visit the hotel again (the bouncer knows within a minute)"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Unbanning failed", token);
    }

    /// <summary>The version that runs: "v1.8.1".</summary>
    public const string VersionCommand = "docker exec " + Container + " cscli version 2>&1 | awk '/^version:/ {print $2}' | cut -d- -f1";

    /// <summary>
    /// Pulls the newest image and recreates the container when it changed, then brings the detection rules (the hub's
    /// collections, parsers and scenarios) up to date. The bans, the enrollment and the bouncer stay; while CrowdSec
    /// restarts the bouncer keeps its ban list and the hotel stays reachable.
    /// </summary>
    public static async Task UpdateAsync(ServerConnection connection, Action<string> log, CancellationToken token = default)
    {
        await ServerTools.UpdateImageAsync(connection, "CrowdSec", Directory, Container, VersionCommand,
            $"docker exec {Container} cscli lapi status >/dev/null 2>&1", log, token);
        string script = RemoteScript.Prelude + $$"""
            echo "> cscli hub update and upgrade (the detection rules)"
            docker exec {{Container}} cscli hub update 2>&1 | grep -viE '^ *$|level=info' | sed 's/^/  /' || true
            out=$(docker exec {{Container}} cscli hub upgrade 2>&1) || { echo "$out" | tail -5 | sed 's/^/  /'; fail "CrowdSec's hub could not be reached: the rules stay as they were."; }
            changed=$(echo "$out" | grep -ciE 'upgrad(ed|ing)|updated|installed' || true)
            if [ "${changed:-0}" -gt 0 ]; then
              echo "$out" | grep -iE 'upgrad(ed|ing)|updated|installed' | head -20 | sed 's/^/  /'
              echo "  Restarting CrowdSec to load the new rules"
              docker restart {{Container}} >/dev/null
              for i in $(seq 1 45); do docker exec {{Container}} cscli lapi status >/dev/null 2>&1 && break; sleep 2; done
              docker exec {{Container}} cscli lapi status >/dev/null 2>&1 || fail "CrowdSec does not start again after the rule update (see: docker logs crowdsec)."
            else
              echo "  The rules were up to date"
            fi
            # The bouncer plugin comes with the installer: Addons → CrowdSec puts the version this installer knows in Traefik.
            plugin=$(grep -A3 '{{Plugin}}:' {{WebAccessInstaller.TraefikDirectory}}/traefik.yml 2>/dev/null | sed -n 's/^ *version: *//p' | head -1)
            if [ -n "$plugin" ] && [ "$plugin" != "{{PluginVersion}}" ]; then
              echo "  Traefik's CrowdSec plugin is $plugin; this installer has {{PluginVersion}}: run Addons → CrowdSec again to update it"
            elif [ -n "$plugin" ]; then
              echo "  Traefik's CrowdSec plugin: $plugin (the newest this installer knows)"
            fi
            """;
        await RemoteScript.RunAsync(connection, script, log, "Updating CrowdSec's rules failed", token);
    }

    /// <summary>Takes the bouncer out of Traefik, then stops CrowdSec; its data only when asked.</summary>
    public static Task RemoveAsync(ServerConnection connection, WebAccessSettings? site, bool deleteData, Action<string> log, CancellationToken token = default)
    {
        string traefik = site is null ? "" : $$"""
            t={{WebAccessInstaller.TraefikDirectory}}
            if [ -f {{MiddlewareFile}} ]; then
              rm -f {{MiddlewareFile}}
              echo "> {{MiddlewareFile}} deleted"
              {{WebAccessInstaller.StaticConfigScript(site)}}
              echo "> Restarting Traefik without the bouncer (players are disconnected for a moment)"
              compose_in "$t" up -d --force-recreate 2>&1 | grep -v '^ *$'
              {{WebAccessInstaller.WaitForTraefikScript}}
            fi
            """;
        string script = RemoteScript.Prelude + $$"""
            c={{Directory}}
            {{traefik}}
            if [ -f "$c/compose.yaml" ]; then
              echo "> docker compose down (CrowdSec)"
              compose_in "$c" down 2>&1 | grep -v '^ *$' || true
            fi
            docker rm -f {{Container}} >/dev/null 2>&1 || true
            rm -f /etc/logrotate.d/traefik-access
            if [ {{(deleteData ? "yes" : "no")}} = yes ]; then
              rm -rf "$c"
              docker image rm {{Image}} >/dev/null 2>&1 || true
              echo "  $c deleted"
            else
              echo "  $c kept (installing again uses its data and enrollment)"
            fi
            """;
        return RemoteScript.RunAsync(connection, script, log, "Removing CrowdSec failed", token);
    }

    [GeneratedRegex("^[A-Za-z0-9]{16,64}$")]
    private static partial Regex KeyPattern();

    [GeneratedRegex("^[A-Za-z0-9._-]{1,64}$")]
    private static partial Regex NamePattern();
}

using AllInOneInstaller.Configuration;

namespace AllInOneInstaller.Remote;

/// <summary>What the server has for EpicNext CMS before the step runs.</summary>
public sealed record EpicNextState(AtomCmsState Server, string? HotelName, string? Origin, bool Built, bool ServiceInstalled, bool ServiceRunning,
    bool AtomTables)
{
    public WebAccessSettings? Site => Server.Site;
    public bool Installed => Site is { EpicNext: true } && Built && ServiceRunning;
}

/// <summary>
/// EpicNext CMS (Next.js, no PHP) as the hotel's website, like AtomCMS: cloned to /var/www/epicnext, built with pnpm on the
/// server itself (not in Docker) and run by systemd as www-data on 127.0.0.1:3002. Its NGINX site on a free port from 85
/// to 95 passes the visitors to it; Octane is on /client/.
/// </summary>
public static class EpicNextInstaller
{
    public const string Repository = "https://gitea.epicnabbo.nl/Remco/EpicNext-Cms.git";
    public const string Name = "EpicNext CMS";
    /// <summary>Its NGINX site: /etc/nginx/sites-available/cms-epicnext.</summary>
    public const string SiteName = "epicnext";
    public const string Directory = CustomCmsInstaller.Parent + "/" + SiteName;
    public const string Service = "epicnext-cms";
    public const string ServiceFile = "/etc/systemd/system/" + Service + ".service";
    public const int Port = 3002;
    public const string Upstream = "http://127.0.0.1:3002";
    /// <summary>Its .nvmrc: &gt;=26.12.1 &lt;27.</summary>
    public const string NodeMinimum = "26.12.1";
    /// <summary>The CMS reads and writes the gamedata here (DEFAULT_GAMEDATA_ROOT in its source).</summary>
    public const string GamedataPath = "/var/www/Gamedata";
    private const string LogFile = "/var/log/epicnext-cms.log";

    // Node.js 26 and corepack come from the Dev tools step; corepack gets the pnpm version package.json pins, without asking.
    private const string Environment =
        "export PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root CI=1 NO_COLOR=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1";

    private static string StopService => $$"""
        if [ -d /run/systemd/system ]; then systemctl stop {{Service}} 2>/dev/null || true
        else pkill -u www-data -f '{{Directory}}/node_modules/next/' 2>/dev/null || true; fi
        """;

    public static async Task<EpicNextState> InspectAsync(ServerConnection connection, CancellationToken token = default)
    {
        AtomCmsState server = await AtomCmsInstaller.InspectAsync(connection, token);
        string script = $$"""
            d={{Directory}}
            echo "name=$(grep -sE '^HOTEL_NAME=' "$d/.env" | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')"
            echo "origin=$(git -c safe.directory="$d" -C "$d" remote get-url origin 2>/dev/null)"
            echo "built=$([ -f "$d/.next/BUILD_ID" ] && echo yes)"
            echo "service=$([ -f {{ServiceFile}} ] && echo yes)"
            echo "running=$(curl -s --noproxy '*' -o /dev/null --max-time 5 -w '%{http_code}' {{Upstream}}/ 2>/dev/null | grep -qvE '^(000)?$' && echo yes)"
            db=$(grep -sE '^db.database=' {{EmulatorInstaller.Directory}}/config.ini | cut -d= -f2 | tr -d '[:space:]')
            [ -n "$db" ] && echo "atom=$(mariadb -N "$db" -e "SELECT 1 FROM website_installation LIMIT 1" >/dev/null 2>&1 && echo yes)"
            """;
        var values = new ScriptValues((await connection.RunAsRootAsync(script, token)).Output);
        return new EpicNextState(server, values["name"], values["origin"], values.Yes("built"), values.Yes("service"), values.Yes("running"), values.Yes("atom"));
    }

    /// <summary>Node.js 26.12.1 or newer (apt upgrades an older Node.js 26 from NodeSource) and pnpm through corepack.</summary>
    public static Task PrepareToolsAsync(ServerConnection connection, Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            {{Environment}}
            # sort -V puts the lower version first.
            older() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" != "$2" ]; }
            v=$(node -v 2>/dev/null | tr -d v)
            [ -n "$v" ] || fail "Node.js is missing: run the Dev tools step first."
            case "$v" in 26.*) ;; *) fail "Node.js $v is installed; EpicNext needs Node.js 26 ({{NodeMinimum}} or newer). Run the Dev tools step first." ;; esac
            if older "$v" {{NodeMinimum}}; then
              echo "> Node.js $v is older than {{NodeMinimum}}: apt-get install --only-upgrade nodejs"
              apt_update >/dev/null
              apt-get install -y --only-upgrade nodejs >/dev/null
              v=$(node -v | tr -d v)
              older "$v" {{NodeMinimum}} && fail "Node.js is still $v after the upgrade; EpicNext needs {{NodeMinimum}} or newer."
            fi
            echo "  Node.js $v"
            if ! command -v corepack >/dev/null 2>&1; then
              echo "> npm install -g corepack"
              npm install -g --no-fund --no-audit corepack >/dev/null
            fi
            cd {{Directory}}
            # The version in package.json's packageManager.
            p=$(corepack pnpm --version 2>&1) || { echo "$p" | tail -5; fail "corepack could not get pnpm (see above)."; }
            echo "  pnpm $p (corepack)"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Preparing Node.js and pnpm failed", token);
    }

    // Double-quotes a .env value; dotenv-expand reads \$ as a plain $.
    private static string EnvValue(string value) =>
        "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("$", "\\$") + "\"";

    /// <summary>
    /// .env from .env.example when it is missing, with the keys this server decides: the hotel database, the site's
    /// address, RCON. A random AUTH_SECRET once; later runs keep it, so logins stay valid. The database login is the first
    /// that works of: the cms login saved on this computer, the one already in .env, AtomCMS' cms login, or else a MariaDB
    /// account of its own (epicnext, only on the hotel database) made with root.
    /// </summary>
    public static Task ConfigureEnvAsync(ServerConnection connection, WebAccessSettings site, string hotelName,
        DatabaseCredentials? credentials, Action<string> log, CancellationToken token = default)
    {
        var values = new List<(string Key, string Value)>
        {
            ("HOTEL_NAME", EnvValue(hotelName)),
            ("APP_URL", site.Url),
            ("AUTH_URL", site.Url),
            // Behind Traefik and NGINX: NextAuth takes the host from the forwarded headers.
            ("AUTH_TRUST_HOST", "true"),
            ("RCON_HOST", "127.0.0.1")
        };
        string sets = string.Join('\n', values.Select(v => $"env_set {v.Key} {ServerConnection.ShellQuote(v.Value)}"));

        string script = RemoteScript.Prelude + $$"""
            cd {{Directory}}
            if [ -f .env ]; then
              cp -p .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
              echo "> {{Directory}}/.env (the old one is kept as .env.bak-<time>)"
            elif [ -f .env.example ]; then
              cp .env.example .env
              echo "> {{Directory}}/.env from .env.example"
            else
              : > .env
              echo "> {{Directory}}/.env (new: the clone has no .env.example)"
            fi
            env_set() {
              if grep -q "^$1=" .env; then
                KEY="$1" VALUE="$2" awk 'index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; next } { print }' .env > .env.new
                cat .env.new > .env && rm -f .env.new
              else
                printf '%s=%s\n' "$1" "$2" >> .env
              fi
              case "$1" in DATABASE_URL) echo "  $1=$(echo "$2" | sed -E 's#://([^:]*):[^@]*@#://\1:***@#')" ;; *SECRET*) echo "  $1=***" ;; *) echo "  $1=$2" ;; esac
            }
            {{sets}}
            secret=$(grep -sE '^AUTH_SECRET=' .env | cut -d= -f2- | tr -d '"')
            if [ ${#secret} -lt 32 ] || echo "$secret" | grep -qiE 'random|change|your'; then
              env_set AUTH_SECRET "$(openssl rand -hex 32)"
            else
              echo "  AUTH_SECRET kept"
            fi
            ini={{EmulatorInstaller.Directory}}/config.ini
            rcon=$(grep -sE '^rcon.port=' "$ini" | cut -d= -f2 | tr -d '[:space:]')
            env_set RCON_PORT "${rcon:-3001}"
            # Without Valkey/Redis on this server EpicNext keeps its cache in memory; a URL to nothing only gives errors.
            if ss -Hltn 'sport = :6379' 2>/dev/null | grep -q .; then echo "  REDIS_URL kept (something listens on 6379)"; else env_set REDIS_URL ""; fi

            # The database login: over TCP to 127.0.0.1, as EpicNext connects.
            db=$(grep -sE '^db.database=' "$ini" | cut -d= -f2 | tr -d '[:space:]')
            [ -n "$db" ] || fail "No db.database in $ini: run the Emulator step first."
            db_ok() { [ -n "$1" ] && [ -n "$2" ] && MYSQL_PWD="$2" mariadb --protocol=tcp -h 127.0.0.1 -P 3306 -u "$1" -N -e 'SELECT 1 FROM users LIMIT 1' "$db" >/dev/null 2>&1; }
            enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
            dbuser= dbpass= from=
            try_login() { if [ -z "$from" ] && db_ok "$1" "$2"; then dbuser=$1 dbpass=$2 from=$3; fi; }
            try_login {{ServerConnection.ShellQuote(credentials?.CmsUser ?? "")}} {{ServerConnection.ShellQuote(credentials?.CmsPassword ?? "")}} "the cms login saved on this computer"
            cur=$(grep -sE '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
            if [ -n "$cur" ]; then
              { read -r u; read -r p; } < <(node -e 'try { const u = new URL(process.argv[1]); console.log(decodeURIComponent(u.username)); console.log(decodeURIComponent(u.password)) } catch { console.log(""); console.log("") }' "$cur")
              [ "$u" = user ] && [ "$p" = password ] || try_login "$u" "$p" "the login already in .env"
            fi
            atom={{AtomCmsInstaller.Directory}}/.env
            value() { grep -sE "^$1=" "$atom" | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/' | tr -d '\r'; }
            try_login "$(value DB_USERNAME)" "$(value DB_PASSWORD)" "AtomCMS' cms login ($atom)"
            if [ -z "$from" ]; then
              # An account of its own, made with root (the socket login), with the cms account's rights on the hotel database only.
              pw=$(openssl rand -hex 24)
              mariadb <<SQL || fail "Making the MariaDB account epicnext failed (see above). Set DATABASE_URL in {{Directory}}/.env yourself and run this step again."
            CREATE USER IF NOT EXISTS 'epicnext'@'localhost' IDENTIFIED BY '$pw';
            ALTER USER 'epicnext'@'localhost' IDENTIFIED BY '$pw';
            CREATE USER IF NOT EXISTS 'epicnext'@'127.0.0.1' IDENTIFIED BY '$pw';
            ALTER USER 'epicnext'@'127.0.0.1' IDENTIFIED BY '$pw';
            GRANT {{MariaDbInstaller.CmsPrivileges}} ON \`$db\`.* TO 'epicnext'@'localhost', 'epicnext'@'127.0.0.1';
            FLUSH PRIVILEGES;
            SQL
              try_login epicnext "$pw" "a new MariaDB account epicnext (only on $db)"
              [ -n "$from" ] || fail "The new MariaDB account epicnext cannot log in on 127.0.0.1:3306."
            fi
            echo "  Database login: $from"
            env_set DATABASE_URL "mysql://$(enc "$dbuser"):$(enc "$dbpass")@127.0.0.1:3306/$(enc "$db")?charset=utf8mb4&connection_limit=25&connect_timeout=5"
            chmod 640 .env
            chown www-data:www-data .env
            """;
        return RemoteScript.RunAsync(connection, script, log, "Writing EpicNext's .env failed", token);
    }

    /// <summary>
    /// pnpm install, its own migrations (only the CMS' tables), and the memory-capped build. The CMS is stopped for the
    /// build, which replaces the .next folder it runs from.
    /// </summary>
    public static Task BuildAsync(ServerConnection connection, Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            {{Environment}}
            cd {{Directory}}
            # Runs a command with its output as it comes (without empty lines), and returns the command's own exit code.
            run() {
              rc=$(mktemp)
              ("$@" 2>&1; echo $? > "$rc") | grep --line-buffered -vE '^\s*$' || true
              code=$(cat "$rc"); rm -f "$rc"
              return "$code"
            }
            # Gamedata where the CMS looks for it, and the folders it writes to.
            g={{OctaneInstaller.Gamedata}}
            if [ "$g" != {{GamedataPath}} ]; then
              if [ -L {{GamedataPath}} ] || [ ! -e {{GamedataPath}} ]; then
                ln -sfn "$g" {{GamedataPath}}
                echo "> {{GamedataPath}} -> $g (the CMS reads the gamedata there)"
              else
                echo "  WARNING: {{GamedataPath}} is a folder of its own, not $g: the CMS uses that one."
              fi
            fi
            echo "> pnpm install --frozen-lockfile"
            run corepack pnpm install --frozen-lockfile --reporter=append-only || fail "pnpm install stopped (see above)."
            echo "> pnpm db:migrate (only the CMS' own tables; the emulator's stay as they are)"
            run corepack pnpm db:migrate || fail "pnpm db:migrate stopped (see above): check DATABASE_URL in {{Directory}}/.env."
            avail=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
            {{StopService}}
            echo "> pnpm build (the CMS is stopped meanwhile; ${avail} MB memory available)"
            [ "$avail" -lt 3000 ] && echo "  WARNING: under 3 GB free: the build may run out of memory (add swap, or stop other services for the build)."
            # The build runs in a cgroup of its own (scripts/with-memory-cap.sh): leave 1 GB for MariaDB, the emulator and NGINX.
            if [ -d /run/systemd/system ]; then export CMS_MEMORY_CAP_RESERVE=1g; else export CMS_MEMORY_CAP_BACKEND=none; echo "  (no systemd: the build runs without a memory cap)"; fi
            run corepack pnpm build || fail "pnpm build stopped (see above). The CMS stays stopped until a build succeeds."
            [ -f .next/BUILD_ID ] || fail "pnpm build did not make .next/BUILD_ID."
            echo "  build $(cat .next/BUILD_ID)"
            install -d public/nitro-assets public/swf storage
            chown -R www-data:www-data {{Directory}}
            chmod -R u+rwX,g+rX,o-w {{Directory}}
            """;
        return RemoteScript.RunAsync(connection, script, log, "Building EpicNext failed", token);
    }

    /// <summary>The systemd service (as www-data, on 127.0.0.1:3002, at boot), started and waited for.</summary>
    public static Task StartServiceAsync(ServerConnection connection, Action<string> log, CancellationToken token = default)
    {
        string start = $"/usr/bin/node {Directory}/node_modules/next/dist/bin/next start -H 127.0.0.1 -p {Port}";
        string script = RemoteScript.Prelude + $$"""
            {{Environment}}
            pid=$(ss -Hltnp "sport = :{{Port}}" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
            # Next.js' own server process runs in the CMS folder.
            if [ -n "$pid" ] && [ "$(readlink /proc/$pid/cwd)" != {{Directory}} ]; then
              ps -o pid=,user=,args= -p "$pid" | sed 's/^/  /'
              fail "Port {{Port}} is used by another program (above): EpicNext runs on 127.0.0.1:{{Port}}. Stop that program first."
            fi
            echo "> {{ServiceFile}}"
            cat > {{ServiceFile}} <<'UNIT'
            # EpicNext CMS (written by All-in-1 Installer, Addons → CMS). NGINX (cms-{{SiteName}}) passes the site here.
            [Unit]
            Description=EpicNext CMS
            After=network-online.target mariadb.service
            Wants=network-online.target

            [Service]
            Type=simple
            User=www-data
            Group=www-data
            WorkingDirectory={{Directory}}
            Environment=NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
            ExecStart={{start}}
            Restart=always
            RestartSec=5

            [Install]
            WantedBy=multi-user.target
            UNIT
            chmod 644 {{ServiceFile}}
            if [ -d /run/systemd/system ]; then
              systemctl daemon-reload
              systemctl enable {{Service}} >/dev/null 2>&1
              systemctl restart {{Service}}
              echo "  {{Service}} enabled and started"
            else
              {{StopService}}
              touch {{LogFile}} && chown www-data {{LogFile}}
              # Only the server itself in the background, with no handle on this session's output (it would keep it open).
              cd {{Directory}}
              setsid runuser -u www-data -- env NODE_ENV=production {{start}} </dev/null >>{{LogFile}} 2>&1 &
              echo "  (no systemd on this machine: started directly, not at boot; log {{LogFile}})"
            fi
            for i in $(seq 1 60); do
              code=$(curl -s --noproxy '*' -o /dev/null --max-time 5 -w '%{http_code}' {{Upstream}}/ || true)
              [ -n "$code" ] && [ "$code" != 000 ] && break
              sleep 2
            done
            if [ -z "$code" ] || [ "$code" = 000 ]; then
              if [ -d /run/systemd/system ]; then journalctl -u {{Service}} -n 30 --no-pager 2>/dev/null | sed 's/^/  /'; else tail -30 {{LogFile}} | sed 's/^/  /'; fi
              fail "EpicNext does not answer on {{Upstream}} after 2 minutes (its log is above)."
            fi
            echo "  {{Upstream}}/ answers HTTP $code"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Starting EpicNext failed", token);
    }

    /// <summary>Stops and disables the service; with <paramref name="delete"/> also its unit and the /var/www/Gamedata link.</summary>
    public static Task RemoveServiceAsync(ServerConnection connection, bool delete, Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            {{StopService}}
            if [ -d /run/systemd/system ]; then systemctl disable {{Service}} >/dev/null 2>&1 || true; fi
            echo "> {{Service}} stopped and off at boot"
            if [ {{(delete ? "yes" : "no")}} = yes ]; then
              rm -f {{ServiceFile}}
              [ -d /run/systemd/system ] && systemctl daemon-reload
              echo "  {{ServiceFile}} deleted"
              [ -L {{GamedataPath}} ] && rm -f {{GamedataPath}} && echo "  {{GamedataPath}} link deleted (the gamedata stays)"
            fi
            true
            """;
        return RemoteScript.RunAsync(connection, script, log, "Stopping EpicNext failed", token);
    }

    /// <summary>Checks through Traefik that the CMS on / and /client, Octane on /client/ and Polaris' /api/health answer.</summary>
    public static Task TestAsync(ServerConnection connection, WebAccessSettings site, Action<string> log, CancellationToken token = default)
    {
        string name = site.IsIpAddress ? "127.0.0.1" : site.Address;
        string port = site.Https ? "443" : "80";
        string script = RemoteScript.Prelude + $$"""
            url="{{site.Scheme}}://{{name}}"
            c() { curl -s --noproxy '*' -k --max-time 20 --resolve "{{name}}:{{port}}:127.0.0.1" "$@"; }
            echo "> $url/ (EpicNext)"
            code=$(c -o /dev/null -w '%{http_code}' "$url/" || true)
            echo "  HTTP $code"
            case "$code" in
              2*|3*) ;;
              000|"") fail "Nothing answers on $url/." ;;
              502|504) fail "$url/ answers HTTP $code: NGINX does not reach EpicNext on {{Upstream}}." ;;
              *) echo "  EpicNext answers HTTP $code: see its log (journalctl -u {{Service}})." ;;
            esac
            echo "> $url/client (EpicNext's client page)"
            echo "  HTTP $(c -o /dev/null -w '%{http_code}' "$url/client" || true)"
            echo "> $url/client/ (Octane)"
            c "$url/client/" | grep -q 'configuration/bootstrap.js' || fail "$url/client/ does not serve Octane."
            echo "  index.html OK"
            echo "> $url/api/health (Polaris)"
            echo "  HTTP $(c -o /dev/null -w '%{http_code}' "$url/api/health" || true)"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Testing EpicNext failed", token);
    }
}

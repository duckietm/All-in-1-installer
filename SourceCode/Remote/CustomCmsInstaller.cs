using System.Text.RegularExpressions;
using AllInOneInstaller.Configuration;

namespace AllInOneInstaller.Remote;

/// <summary>What the server has for your own CMS before the step runs.</summary>
public sealed record CustomCmsState(AtomCmsState Server, string? CurrentName, string? CurrentRoot, bool? CurrentPhp, bool FolderHasContent)
{
    public WebAccessSettings? Site => Server.Site;
}

/// <summary>
/// Your own CMS as the hotel's website, like AtomCMS: from a Git link or a ZIP, in /var/www/&lt;name&gt;, served by its own
/// NGINX site (PHP 8.5 or static) on a free port from 85 to 95, with Octane on /client. Its database settings are yours.
/// </summary>
public static partial class CustomCmsInstaller
{
    public const string Parent = "/var/www";
    public const int MaxNameLength = 12;

    public static string Directory(string name) => $"{Parent}/{name}";

    /// <summary>The folder name: lower case letters and digits, at most 12, and not a folder the hotel already uses.</summary>
    public static string? NameProblem(string name)
    {
        if (name.Length == 0) return "Enter a folder name.";
        if (!NamePattern().IsMatch(name))
            return $"Use only lower case letters (a-z) and digits, no spaces or other characters, at most {MaxNameLength}.";
        string path = Directory(name);
        if (name is "html" or "hotel" or "client" or "gamedata" or "custom" ||
            ServerLayout.Current.Paths.Any(p => string.Equals(p.Value.TrimEnd('/'), path, StringComparison.OrdinalIgnoreCase)))
            return $"{path} is used by the hotel already: choose another name.";
        return null;
    }

    /// <summary>The root inside the CMS folder: "/" or "/public", "/web/dist" ...</summary>
    public static string? RootProblem(string root) =>
        RootPattern().IsMatch(root) && !root.Split('/').Any(part => part is "." or "..")
            ? null
            : "The root starts with / and has only letters, digits, '.', '_', '-' and '/', for example /public, or just / for the top folder.";

    /// <summary>An https Git link, such as https://github.com/owner/cms or https://github.com/owner/cms.git.</summary>
    public static string? GitUrlProblem(string url) =>
        GitUrlPattern().IsMatch(url) ? null : "Use the https link of the repository, for example https://github.com/owner/cms.git.";

    /// <summary>A folder name from a repository link: "https://github.com/owner/My-CMS.git" gives "mycms".</summary>
    public static string NameFromUrl(string url)
    {
        string last = url.TrimEnd('/').Split('/').Last();
        if (last.EndsWith(".git", StringComparison.OrdinalIgnoreCase)) last = last[..^4];
        string name = new string(last.ToLowerInvariant().Where(c => c is >= 'a' and <= 'z' or >= '0' and <= '9').ToArray());
        return name.Length > MaxNameLength ? name[..MaxNameLength] : name;
    }

    /// <summary>"/public" or "/"; with the folder: /var/www/name/public.</summary>
    public static string NormalizeRoot(string root) => root.Trim() is var r && r.Length > 1 ? r.TrimEnd('/') : "/";
    public static string RootPath(string name, string root) => NormalizeRoot(root) == "/" ? Directory(name) : Directory(name) + NormalizeRoot(root);

    public static async Task<CustomCmsState> InspectAsync(ServerConnection connection, string? name, CancellationToken token = default)
    {
        AtomCmsState server = await AtomCmsInstaller.InspectAsync(connection, token);
        string? current = server.Site?.CustomCms;
        string? look = name is { Length: > 0 } && NameProblem(name) is null ? name : current;
        string? root = null;
        bool? php = null;
        bool content = false;
        if (look is not null)
        {
            string script = $$"""
                f={{CmsSite.File(look)}}
                echo "root=$(awk '$1=="root" {gsub(/;/, "", $2); print $2; exit}' "$f" 2>/dev/null)"
                echo "php=$([ -f "$f" ] && { grep -q fastcgi_pass "$f" && echo yes || echo no; })"
                echo "content=$([ -n "$(ls -A {{Directory(look)}} 2>/dev/null)" ] && echo yes)"
                """;
            var values = new ScriptValues((await connection.RunAsRootAsync(script, token)).Output);
            if (values["root"] is { } full && full.StartsWith(Directory(look), StringComparison.Ordinal))
                root = full.Length == Directory(look).Length ? "/" : full[Directory(look).Length..];
            php = values["php"] switch { "yes" => true, "no" => false, _ => null };
            content = values.Yes("content");
        }
        return new CustomCmsState(server, current, root, php, content);
    }

    /// <summary>Whether the server can read the repository; a private repository would ask for a password, which hangs.</summary>
    public static Task CheckGitAccessAsync(ServerConnection connection, string url, Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            if ! command -v git >/dev/null 2>&1; then
              echo "> Installing git"
              apt_update >/dev/null
              apt-get install -y git >/dev/null
            fi
            u={{ServerConnection.ShellQuote(url)}}
            echo "> git ls-remote $u"
            heads=$(GIT_TERMINAL_PROMPT=0 timeout 60 git ls-remote --heads "$u" 2>&1) ||
              fail "The server cannot read $u: it does not exist, or it is private. Make it public, or download it as a ZIP and use the ZIP option."
            echo "  $(echo "$heads" | grep -c refs/heads) branches"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Reading the repository failed", token);
    }

    /// <summary>
    /// Unpacks an uploaded ZIP into the CMS folder, which must not exist or be empty. A ZIP with one folder at the top
    /// (as GitHub's "Download ZIP" makes) gives that folder's content. Removes the upload.
    /// </summary>
    public static Task ExtractZipAsync(ServerConnection connection, string remoteZip, string name, Action<string> log, CancellationToken token = default)
    {
        string script = RemoteScript.Prelude + $$"""
            z={{ServerConnection.ShellQuote(remoteZip)}}
            d={{Directory(name)}}
            tmp=
            trap 'rm -f "$z"; [ -n "$tmp" ] && rm -rf "$tmp"' EXIT
            if ! command -v unzip >/dev/null 2>&1; then
              echo "> Installing unzip"
              apt_update >/dev/null
              apt-get install -y unzip >/dev/null
            fi
            [ -z "$(ls -A "$d" 2>/dev/null)" ] || fail "$d is not empty."
            unzip -tq "$z" >/dev/null 2>&1 || fail "$(basename "$z") is not a ZIP file, or it is damaged."
            tmp=$(mktemp -d {{Parent}}/.cms-unzip-XXXXXX)
            echo "> unzip $(basename "$z") ($(du -h "$z" | cut -f1))"
            # unzip refuses paths that leave the folder (../); -o: no questions.
            unzip -q -o "$z" -d "$tmp" || fail "unzip stopped (see above)."
            src="$tmp"
            # One folder at the top and nothing else: that folder is the CMS.
            if [ "$(ls -A "$tmp" | wc -l)" = 1 ] && [ -d "$tmp/$(ls -A "$tmp")" ]; then
              src="$tmp/$(ls -A "$tmp")"
              echo "  The ZIP has one folder at the top ($(basename "$src")): using what is in it"
            fi
            install -d -m 755 "$d"
            (shopt -s dotglob; mv "$src"/* "$d"/)
            echo "  $(find "$d" -type f | wc -l) files in $d"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Unpacking the ZIP failed", token);
    }

    /// <summary>Checks that the root exists and has a start page, and gives the folder to www-data (PHP-FPM and NGINX).</summary>
    public static Task PrepareAsync(ServerConnection connection, string name, string root, bool php, Action<string> log, CancellationToken token = default)
    {
        string path = RootPath(name, root);
        string script = RemoteScript.Prelude + $$"""
            d={{Directory(name)}}
            r={{path}}
            if [ ! -d "$r" ]; then
              echo "  The folders at the top of $d:"
              find "$d" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '    /%f\n' | sort | head -20
              fail "The root {{NormalizeRoot(root)}} does not exist in $d. Choose the folder with the start page ({{(php ? "index.php" : "index.html")}}), from the list above."
            fi
            echo "> Root $r"
            found=
            for f in {{(php ? "index.php index.html" : "index.html index.htm")}}; do [ -f "$r/$f" ] && { found=$f; break; }; done
            if [ -n "$found" ]; then echo "  start page: $found"; else echo "  WARNING: no {{(php ? "index.php" : "index.html")}} in $r: the address of the site shows 'not found' until there is one."; fi
            if [ {{(php ? "yes" : "no")}} = no ] && find "$r" -maxdepth 2 -name '*.php' | grep -q .; then
              echo "  WARNING: there are .php files, but the site is set up as static: NGINX sends them as text. Choose PHP if the CMS needs it."
            fi
            chown -R www-data:www-data "$d"
            chmod -R u+rwX,g+rX,o-w "$d"
            # Laravel and most PHP CMSes write here.
            for w in storage bootstrap/cache cache tmp uploads; do [ -d "$d/$w" ] && chmod -R ug+rwX "$d/$w"; done
            echo "  $d belongs to www-data (PHP-FPM and NGINX)"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Checking the CMS folder failed", token);
    }

    /// <summary>Checks through Traefik that the CMS, /client/ and Polaris' /api/health answer. A CMS error page is not a failure.</summary>
    public static Task TestAsync(ServerConnection connection, WebAccessSettings site, Action<string> log, CancellationToken token = default)
    {
        string name = site.IsIpAddress ? "127.0.0.1" : site.Address;
        string port = site.Https ? "443" : "80";
        string script = RemoteScript.Prelude + $$"""
            url="{{site.Scheme}}://{{name}}"
            c() { curl -s --noproxy '*' -k --max-time 15 --resolve "{{name}}:{{port}}:127.0.0.1" "$@"; }
            echo "> $url/ ({{site.CmsName}})"
            code=$(c -o /dev/null -w '%{http_code}' "$url/" || true)
            echo "  HTTP $code"
            case "$code" in
              2*|3*) ;;
              000|"") fail "Nothing answers on $url/." ;;
              5*) echo "  The CMS answers with an error: usually its database settings are not filled in yet (see the end of this step)." ;;
              *) echo "  The CMS answers HTTP $code: check the root folder and the start page." ;;
            esac
            echo "> $url/client/ (Octane)"
            c "$url/client/" | grep -q 'configuration/bootstrap.js' || fail "$url/client/ does not serve Octane."
            echo "  index.html OK"
            echo "> $url/api/health (Polaris)"
            echo "  HTTP $(c -o /dev/null -w '%{http_code}' "$url/api/health" || true)"
            """;
        return RemoteScript.RunAsync(connection, script, log, "Testing the CMS failed", token);
    }

    [GeneratedRegex("^[a-z0-9]{1,12}$")]
    private static partial Regex NamePattern();

    [GeneratedRegex("^/([A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*/?)?$")]
    private static partial Regex RootPattern();

    [GeneratedRegex("^https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9._~/-]+$")]
    private static partial Regex GitUrlPattern();
}

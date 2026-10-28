namespace AllInOneInstaller.Remote;

/// <summary>
/// The local ports (127.0.0.1) for the web apps behind Traefik: a CMS' NGINX site, Gitea. The first free one from 85 to 95,
/// where free means nothing listens there, no NGINX config uses it and no Docker container (also a stopped one) publishes it.
/// </summary>
public static class LocalPorts
{
    public const int First = 85;
    public const int Last = 95;

    // Every container's name and the host ports it publishes, also when it is stopped (docker ps only shows running ones).
    // Go template braces cannot appear in the $$ raw strings.
    private const string DockerPorts = "{{.Name}} {{range $p, $c := .HostConfig.PortBindings}}{{range $c}}{{.HostPort}} {{end}}{{end}}";

    /// <summary>
    /// pick_port PREVIOUS sets $port: PREVIOUS when it is still free for this app, else the first free one (and fails when
    /// there is none). The app is <c>$self_file</c> (its NGINX site) or <c>$self_container</c> (its Docker container):
    /// a port they hold already counts as free for them. Says in the log why a port was skipped.
    /// </summary>
    public static string Functions => $$"""
        port_container() {
          command -v docker >/dev/null 2>&1 || return 0
          docker ps -aq 2>/dev/null | xargs -r docker inspect -f '{{DockerPorts}}' 2>/dev/null | grep -E " $1( |$)" | head -1 | awk '{print $1}' | tr -d /
        }
        port_taken() {
          container=$(port_container "$1")
          # This app's own port (a run again) is not taken.
          [ -n "${self_container:-}" ] && [ "$container" = "$self_container" ] && return 1
          who=$(ss -Hltnp "sport = :$1" 2>/dev/null | grep -oE 'users:\(\("[^"]+"' | head -1 | cut -d'"' -f2)
          if ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; then
            [ -n "${self_file:-}" ] && [ "$who" = nginx ] && grep -qsE "listen[[:space:]]+([^;[:space:]]*:)?$1([[:space:]]|;)" "$self_file" && return 1
            echo "in use by ${who:-a program}"; return 0
          fi
          other=$(grep -rlsE "^[^#]*listen[[:space:]]+([^;[:space:]]*:)?$1([[:space:]]|;)" /etc/nginx 2>/dev/null | grep -vx "${self_file:-/nonexistent}" | head -1)
          [ -n "$other" ] && { echo "used by $other"; return 0; }
          [ -n "$container" ] && { echo "published by the Docker container $container"; return 0; }
          return 1
        }
        pick_port() {
          port=$1
          if [ -n "$port" ] && reason=$(port_taken "$port"); then
            echo "  Port $port, which this had, is $reason now: choosing another one"
            port=
          fi
          if [ -z "$port" ]; then
            for p in $(seq {{First}} {{Last}}); do
              if reason=$(port_taken "$p"); then echo "  Port $p: $reason"; continue; fi
              port=$p; break
            done
          fi
          [ -n "$port" ] || fail "Ports {{First}} to {{Last}} are all in use on this server: free one and try again."
        }
        """;
}

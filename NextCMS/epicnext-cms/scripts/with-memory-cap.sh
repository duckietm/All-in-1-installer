#!/usr/bin/env bash
# Voer een zwaar commando uit onder een harde geheugenplafond.
#
# Waarom dit bestaat:
#   De host draait met `vm.overcommit_memory=0` en ZONDER swap. Vraagt een
#   proces meer geheugen dan er vrij is, dan geeft de kernel niets weg en
#   roept hij meteen de OOM-killer aan. Die kiest zijn slachtoffer over de
#   héle machine, niet alleen in het schuldige proces — dus een build kan de
#   database, nginx of de live release meenemen.
#
#   `next build` op Turbopack groeit op dit 329-route app voorbij 12GB RSS
#   en is ook met 4GB swap nog steeds dood. Zie commit 3d828a61.
#
# Wat dit doet:
#   Het commando komt in zijn eigen cgroup met `MemoryMax`. Als het door die
#   grens heen groeit krijgt alleen die cgroup een OOM-signaal: het commando
#   zelf sterft, de rest van de machine leeft. Dat is precies het gedrag dat
#   je wilt — de build faalt, de site blijft staan.
#
#   Met `--max-old-space-size` lukt dat niet. Die limiet zit op de V8-heap en
#   Turbopack-geheugen is native Rust-geheugen; met een 2GB cap piekte de RSS
#   alsnog op 8GB. Zie het commentaar in de Dockerfile.
#
# Backends:
#
#   systemd (cgroup MemoryMax)
#     Meet RSS over de héle procesboom. Dit is de echte garantie en wordt
#     overal gebruikt waar systemd beschikbaar is (de host waar deze
#     CMS draait). De plafonds in package.json zijn hierop gekozen:
#     `next build` piekt op ~9,7GB in `memory.current` (inclusief de
#     page cache die de build zelf opbouwt), dus 10GB laat net genoeg ruimte
#     over terwijl er ~6-9GB basislast naast blijft passen op deze machine.
#
#     Twee extra vangnetten, omdat de basislast inmiddels groter kan zijn
#     (Docker, de emulator en de agent tikken samen ~9GB aan) en een vaste cap
#     die hoger is dan het vrije geheugen de host alsnog kan laten OOM-killen:
#       - MemoryHigh (95% van de cap) dwingt de kernel eerder te reclaimen en
#         te throttlen, zodat een allocatiestorm de harde grens niet voorbij
#         schiet voordat de cgroup-OOM-killer reageert;
#       - het plafond wordt teruggeschroefd tot `MemAvailable - reserve`, met
#         `CMS_MEMORY_CAP_RESERVE` (standaard 4g) als marge voor de rest van
#         de machine. Is er minder dan 1GB over, dan weigert het script.
#     MemorySwapMax=0 staat expliciet aan: deze host heeft geen swap.
#
#   ulimit -v (per proces, virtuele adresruimte)
#     Alleen als expliciet gevraagd. Meet virtuele adresruimte, NIET RSS, en
#     kan de boom helemaal niet begrenzen: elke worker krijgt z'n eigen
#     limiet. Op moderne V8 is het bovendien een vergiftigde gift: `-v 10g`
#     laat V8 de heaplimiet terugbrengen naar 2,25GB (webpack sterft met
#     std::bad_alloc), en `-v 20g` laat de v8-wasm-memory-toewijzing falen
#     tijdens `next build`. Zet CMS_MEMORY_CAP_VIRTUAL ruim boven de fysieke
#     RAM als je het echt wilt gebruiken.
#
#   Geen van beide -> weigeren. Stil onbegrensd doorlopen zou precies de
#   valse geruststelling zijn waar 3d828a61 voor waarschuwt. Omgevingen
#   zonder systemd (de Docker-build, de GitLab-runner) kiezen daarom
#   expliciet voor CMS_MEMORY_CAP_BACKEND=none — met een waarschuwing,
#   en met als rechtvaardiging dat die builds al begrensd zijn door
#   `next build --webpack` + `--max-old-space-size` en in hun eigen
#   geïsoleerde container draaien, niet op de host.
#
# Markering:
#   Elke backend zet `CMS_MEMORY_CAPPED=1` voordat het commando start.
#   `next.config.ts` weigert een productie-build zonder die markering, zodat
#   een handmatig `npx next build` (of een IDE/agent die de build zelf
#   start) niet meer onbeperkt geheugen kan vragen en de hele host mee
#   neemt. `CMS_MEMORY_CAP_BACKEND=none` telt mee: die omgevingen draaien
#   al in een eigen, geïsoleerde container.
#
# Gebruik: bash scripts/with-memory-cap.sh 10g <command...>
# Backend kiezen: CMS_MEMORY_CAP_BACKEND=systemd|ulimit|none|auto
# ulimit-waarde kiezen: CMS_MEMORY_CAP_VIRTUAL=40g
# Marge bovenop de basislast: CMS_MEMORY_CAP_RESERVE=4g
set -Eeuo pipefail

usage() {
	echo "gebruik: $0 <plafond, bv. 10g> <command...>" >&2
	exit 64
}

[ "$#" -ge 2 ] || usage
cap="$1"
shift

# Zet 10g / 512m / 2G / 1234567 om in bytes. Alleen bytes gaan naar
# systemd: MemoryMax accepteert `10G` maar weigert `10g`, en die
# hoofdletterval is te makkelijk om per ongeluk te treffen.
to_bytes() {
	local value="$1" number suffix
	if [[ "$value" =~ ^([0-9]+)([kKmMgGtT]?)$ ]]; then
		number="${BASH_REMATCH[1]}"
		suffix="${BASH_REMATCH[2]}"
	else
		echo "onbekend plafond-formaat: $value" >&2
		return 1
	fi
	case "$suffix" in
	k | K) echo $((number * 1024)) ;;
	m | M) echo $((number * 1024 * 1024)) ;;
	g | G) echo $((number * 1024 * 1024 * 1024)) ;;
	t | T) echo $((number * 1024 * 1024 * 1024 * 1024)) ;;
	*) echo "$number" ;;
	esac
}

bytes="$(to_bytes "$cap")" || exit 64
kilobytes=$((bytes / 1024))

# De virtuele waarde voor ulimit -v. Bewust los van `cap`: zie de toelichting
# hierboven, 10g -v breekt de webpack-build.
virtual_bytes="$(to_bytes "${CMS_MEMORY_CAP_VIRTUAL:-40g}")" || exit 64
virtual_kb=$((virtual_bytes / 1024))

backend="${CMS_MEMORY_CAP_BACKEND:-auto}"
systemd_cmd=()

# Vanaf hier is dit script de enige plek waar een zwaar commando nog mag
# starten. De markering maakt dat afdwingbaar in next.config.ts.
export CMS_MEMORY_CAPPED=1

# Gebruik hoogstens de helft van de cores, zodat de machine niet op 100% CPU
# piekt, maar behoud voldoende parallelle kracht op (Ryzen) hosts.
cpu_count="$(nproc 2>/dev/null || echo 1)"
worker_cores=$((cpu_count / 2))
[ "$worker_cores" -lt 1 ] && worker_cores=1
cpu_affinity="0-$((worker_cores - 1))"

# Echt proberen, niet alleen uitzoeken of het bestand bestaat: `systemd-run`
# zonder rechten faalt met "Access denied", en dat moet dan een nette
# terugval naar ulimit worden in plaats van een kapotte build.
probe_systemd() {
	command -v systemd-run >/dev/null 2>&1 || return 1
	[ -d /run/systemd/system ] || return 1
	if systemd-run --scope --quiet true 2>/dev/null; then
		systemd_cmd=(systemd-run --scope --quiet)
		return 0
	fi
	if systemd-run --user --scope --quiet true 2>/dev/null; then
		systemd_cmd=(systemd-run --user --scope --quiet)
		return 0
	fi
	return 1
}

# Beschikbaar geheugen in bytes: wat het systeem kan toewijzen zonder te
# swappen. Dit is inclusief opvraagbare page cache, dus de juiste maat om te
# bepalen hoeveel een nieuwe cgroup nog mag gebruiken zonder de host in de
# globale OOM-killer te duwen.
mem_available_bytes() {
	local kb
	kb="$(grep -m1 '^MemAvailable:' /proc/meminfo 2>/dev/null | tr -dc '0-9')"
	[ -n "$kb" ] || kb=0
	echo $((kb * 1024))
}

run_systemd() {
	local effective="$bytes"
	# Houd marge voor de al draaiende basislast (MariaDB, Docker, de live
	# release, de agent) plus kernel/page cache. Zonder die marge kan een cap
	# die hoger is dan het werkelijk beschikbare geheugen alsnog de host laten
	# OOM-killen voordat de cgroup-grens grijpt.
	local reserve
	reserve="$(to_bytes "${CMS_MEMORY_CAP_RESERVE:-4g}")" || exit 64
	local available
	available="$(mem_available_bytes)"
	if [ "$available" -gt 0 ]; then
		local headroom=$((available > reserve ? available - reserve : 0))
		if [ "$headroom" -lt "$effective" ]; then
			echo "[mem-cap] plafond verlaagd naar $((headroom / 1024 / 1024))MB: MemAvailable=$((available / 1024 / 1024))MB reserve=$((reserve / 1024 / 1024))MB" >&2
			effective="$headroom"
		fi
	fi
	if [ "$effective" -lt $((1024 * 1024 * 1024)) ]; then
		echo "[mem-cap] te weinig vrij geheugen (MemAvailable=$((available / 1024 / 1024))MB) om begrensd te starten; weiger." >&2
		echo "[mem-cap] maak geheugen vrij of verhoog CMS_MEMORY_CAP_RESERVE bewust niet." >&2
		return 1
	fi
	# MemoryHigh laat de kernel proactief reclaimen en throttlen vóór de harde
	# MemoryMax, zodat een snelle allocatiestorm niet voorbij de grens schiet en
	# de (globale) OOM-killer de hele machine meeneemt. MemorySwapMax=0 is
	# expliciet: deze host heeft geen swap.
	local high=$((effective * 95 / 100))
	echo "[mem-cap] systemd cgroup MemoryHigh=$((high / 1024 / 1024))MB MemoryMax=$((effective / 1024 / 1024))MB MemorySwapMax=0: $*" >&2
	exec "${systemd_cmd[@]}" -E "PATH=$PATH" -p "MemoryHigh=$high" -p "MemoryMax=$effective" -p "MemorySwapMax=0" -p "AllowedCPUs=$cpu_affinity" "$@"
}

run_ulimit() {
	echo "[mem-cap] ulimit -v ${virtual_kb}KB per proces (geen systemd; RSS-plafond ${cap} niet meetbaar zonder cgroup): $*" >&2
	if [ "$virtual_bytes" -lt $((16 * 1024 * 1024 * 1024)) ]; then
		echo "[mem-cap] let op: -v onder 16g verlaagt V8's heaplimiet en breekt de build; verhoog CMS_MEMORY_CAP_VIRTUAL" >&2
	fi
	ulimit -v "$virtual_kb" || {
		echo "[mem-cap] ulimit -v $virtual_kb werd geweigerd" >&2
		return 1
	}
	if command -v taskset >/dev/null 2>&1; then
		exec taskset -c "$cpu_affinity" "$@"
	else
		exec "$@"
	fi
}

run_refuse() {
	echo "[mem-cap] geen systemd hier; weiger onbegrensd te draaien." >&2
	echo "[mem-cap] zet CMS_MEMORY_CAP_BACKEND=none om dit bewust te accepteren, of =ulimit voor een per-proces vangnet." >&2
	return 1
}

run_opted_out() {
	echo "[mem-cap] WAARSCHUWING: plafond bewust uitgeschakeld, dit commando kan de machine laten OOM-killed worden: $*" >&2
	if command -v taskset >/dev/null 2>&1; then
		exec taskset -c "$cpu_affinity" "$@"
	else
		exec "$@"
	fi
}

case "$backend" in
systemd)
	probe_systemd || {
		echo "[mem-cap] CMS_MEMORY_CAP_BACKEND=systemd maar systemd-run reageert niet" >&2
		exit 70
	}
	run_systemd "$@"
	;;
ulimit)
	run_ulimit "$@"
	;;
none | off)
	run_opted_out "$@"
	;;
auto)
	if probe_systemd; then
		run_systemd "$@"
	else
		run_refuse "$@"
	fi
	;;
*)
	echo "[mem-cap] onbekende backend: $backend" >&2
	exit 64
	;;
esac

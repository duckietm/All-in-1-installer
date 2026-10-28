#!/usr/bin/env python3
"""
Full furnidata translation script using LibreTranslate.
Translates all customs (missing official translations) for all 13 languages.
Run from /var/www/atom-nexst
"""

import json
import pathlib
import os
import time
import concurrent.futures
import urllib.request
import sys

# ── Config ─────────────────────────────────────────────────────────────
MASTER_PATH = "/var/www/Gamedata/config/FurnitureData.json"
OUT_DIR = "/var/www/Gamedata/config"
CACHE_PATH = "/var/www/Gamedata/config/.translations_libre_cache.json"
LIBRE_URL = "http://127.0.0.1:5000/translate"
CONCURRENCY = 6
LANGUAGES = [
    ("nl", "nl"),
    ("en", "com"),
    ("de", "de"),
    ("fr", "fr"),
    ("es", "es"),
    ("tr", "com.tr"),
    ("it", "it"),
    ("pt", "com.br"),
    ("fi", "fi"),
    ("pl", "com"),
    ("ru", "com"),
    ("ar", "com"),
    ("ja", "com"),
]
OFFICIAL_HOTEL_LANGS = {"nl", "en", "de", "fr", "es", "tr", "it", "pt", "fi"}
# ────────────────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
}

def load_json(path):
    return json.loads(pathlib.Path(path).read_text())

def save_json(path, data):
    tmp = path + ".tmp"
    pathlib.Path(tmp).write_text(json.dumps(data, ensure_ascii=False))
    os.rename(tmp, path)
    os.chmod(path, 0o640)
    try:
        import pwd, grp
        os.chown(path, pwd.getpwnam("www-data").pw_uid, grp.getgrnam("www-data").gr_gid)
    except:
        pass

def build_map(data):
    m = {}
    for sec in ("roomitemtypes", "wallitemtypes"):
        for e in data[sec]["furnitype"]:
            cn = e["classname"]
            if cn not in m:
                m[cn] = {"name": e.get("name", ""), "description": e.get("description", "")}
    return m

def is_meaningful(text, classname):
    if not isinstance(text, str):
        return False
    t = text.strip()
    if not t:
        return False
    if t == classname:
        return False
    if t == f"{classname} desc":
        return False
    if t == f"{classname} name":
        return False
    if len(t) < 2:
        return False
    return True

def libre_translate(text, target, cache):
    key = f"{target}|{text}"
    if key in cache:
        return cache[key]
    data = json.dumps({"q": text, "source": "en", "target": target, "format": "text"}).encode()
    req = urllib.request.Request(LIBRE_URL, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            out = json.loads(r.read().decode()).get("translatedText", text)
    except Exception as e:
        print(f"  LibreTranslate error for {target} '{text[:40]}': {e}")
        out = text
    cache[key] = out
    return out

def fetch_official(lang, hotel):
    if lang not in OFFICIAL_HOTEL_LANGS:
        return {}
    url = f"https://www.habbo.{hotel}/gamedata/furnidata_json/1"
    print(f"  Fetching official {lang} from habbo.{hotel}...")
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
    except Exception as e:
        print(f"  Failed to fetch official {lang}: {e}")
        return {}
    fmap = {}
    for sec in ("roomitemtypes", "wallitemtypes"):
        for e in data.get(sec, {}).get("furnitype", []):
            cn = e.get("classname", "")
            if not cn or cn in fmap:
                continue
            fmap[cn] = {"name": e.get("name", ""), "description": e.get("description", "")}
    print(f"  Official {lang}: {len(fmap)} translations")
    return fmap

def translate_batch(texts, target, cache, concurrency=CONCURRENCY):
    if not texts:
        return {}
    print(f"  Translating {len(texts)} unique texts to {target} with {concurrency} workers...")
    start = time.time()
    out = {}
    missing = [t for t in texts if f"{target}|{t}" not in cache]
    if not missing:
        return {t: cache[f"{target}|{t}"] for t in texts}
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as ex:
        futs = {ex.submit(libre_translate, t, target, cache): t for t in missing}
        done = 0
        for f in concurrent.futures.as_completed(futs):
            t = futs[f]
            try:
                out[t] = f.result()
            except Exception as e:
                print(f"  Failed {t[:40]}: {e}")
                out[t] = t
            done += 1
            if done % 100 == 0:
                elapsed = time.time() - start
                print(f"    {done}/{len(missing)} in {elapsed:.1f}s ({elapsed/max(done,1):.2f}s/req)")
    elapsed = time.time() - start
    print(f"  Done {len(texts)} texts to {target} in {elapsed:.1f}s")
    return out

def main():
    print("Loading master FurnitureData.json...")
    master = load_json(MASTER_PATH)
    master_map = build_map(master)
    print(f"Master: {len(master_map)} entries")

    # Load or create cache
    cache = {}
    if os.path.exists(CACHE_PATH):
        try:
            cache = load_json(CACHE_PATH)
            print(f"Loaded cache: {len(cache)} entries")
        except Exception:
            print("Cache corrupt, starting fresh")
            cache = {}

    # For each language
    for lang, hotel in LANGUAGES:
        if lang == "en":
            print(f"\n=== {lang} (source) ===")
            # en file is just copy of master
            out_path = f"{OUT_DIR}/FurnitureData_en.json"
            save_json(out_path, master)
            print(f"  Wrote {out_path}")
            continue

        out_path = f"{OUT_DIR}/FurnitureData_{lang}.json"
        print(f"\n=== {lang} (hotel: {hotel}) ===")

        # Fetch official translations if available
        official = fetch_official(lang, hotel) if lang in OFFICIAL_HOTEL_LANGS else {}

        # Clone master
        cloned = json.loads(json.dumps(master))
        translated = 0
        official_count = 0
        libre_count = 0

        # Collect all texts needing translation (customs not covered by official)
        missing_names = set()
        missing_descs = set()

        for sec in ("roomitemtypes", "wallitemtypes"):
            for e in cloned[sec]["furnitype"]:
                cn = e["classname"]
                t = official.get(cn)
                if not t and "*" in cn:
                    base = cn.split("*")[0]
                    t = official.get(f"{base}*0") or official.get(base)
                if not t and "*" not in cn:
                    t = official.get(f"{cn}*0")

                orig_name = e["name"]
                orig_desc = e.get("description", "")

                # Apply official if available
                if t:
                    did = False
                    if t.get("name"):
                        e["name"] = t["name"]
                        did = True
                    if t.get("description"):
                        e["description"] = t["description"]
                        did = True
                    if did:
                        translated += 1
                        official_count += 1
                        continue

                # Collect missing for LibreTranslate
                if is_meaningful(orig_name, cn):
                    missing_names.add(orig_name.strip())
                if is_meaningful(orig_desc, cn):
                    missing_descs.add(orig_desc.strip())

        print(f"  Official applied: {official_count}, missing for Libre: {len(missing_names)} names, {len(missing_descs)} descs")

        # Translate missing via LibreTranslate
        if missing_names:
            tr_names = translate_batch(missing_names, lang, cache, CONCURRENCY)
            for sec in ("roomitemtypes", "wallitemtypes"):
                for e in cloned[sec]["furnitype"]:
                    cn = e["classname"]
                    orig = e["name"]
                    if is_meaningful(orig, cn):
                        tr = tr_names.get(orig.strip())
                        if tr and tr != orig:
                            e["name"] = tr
                            translated += 1
                            libre_count += 1

        if missing_descs:
            tr_descs = translate_batch(missing_descs, lang, cache, CONCURRENCY)
            for sec in ("roomitemtypes", "wallitemtypes"):
                for e in cloned[sec]["furnitype"]:
                    cn = e["classname"]
                    orig = e.get("description", "")
                    if is_meaningful(orig, cn):
                        tr = tr_descs.get(orig.strip())
                        if tr and tr != orig:
                            e["description"] = tr
                            translated += 1
                            libre_count += 1

        # Save cache after each language
        save_json(CACHE_PATH, cache)
        print(f"  LibreTranslate applied: {libre_count}, total translated: {translated}")

        # Write output
        save_json(out_path, cloned)
        print(f"  Wrote {out_path} ({pathlib.Path(out_path).stat().st_size / 1024 / 1024:.1f} MB)")

    # Final cache save
    save_json(CACHE_PATH, cache)
    print(f"\n=== All done! Cache: {len(cache)} entries ===")

    # Summary
    for lang, _ in LANGUAGES:
        fmap = build_map(load_json(f"{OUT_DIR}/FurnitureData_{lang}.json"))
        ident = sum(1 for k, v in master_map.items() if fmap.get(k) and fmap[k]["name"] == v["name"])
        pct = (len(master_map) - ident) / len(master_map) * 100
        print(f"  {lang}: {len(master_map)-ident}/{len(master_map)} translated ({pct:.1f}%)")

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""Refuse to build a marktile.app whose languages disagree with each other or with the engine.

    python3 scripts/check-l10n.py                 # the sources: Localization/ + Sources/
    python3 scripts/check-l10n.py <app>.app       # what actually shipped: <app>/Contents/Resources

Checks, each one a way a menu ends up half-translated without anything else noticing:

  1. The set of languages is exactly the engine's (i18n/*.json at the repo root). The Mac host may
     not speak a language the editor inside it cannot, nor drop one the editor has.
  2. Every language has exactly the keys English has, in both tables, and the same format
     specifiers for each key (a missing %@ prints the app name nowhere; an extra one crashes).
  3. Sources only: every L("...") in the Swift code has an English entry, every English entry is
     still used, and no menu title or error text is passed as a bare literal that skips L().
  4. CJK values use full-width punctuation and no em dashes (see the house voice rules).
  5. Shipped app only: Info.plist's CFBundleLocalizations names exactly the .lproj folders inside it.

Values are parsed by `plutil`, the same reader the system uses, not by a regex of our own.
"""
import glob, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MAC = os.path.dirname(HERE)                      # hosts/mac
REPO = os.path.dirname(os.path.dirname(MAC))     # repo root
TABLES = ["Localizable", "InfoPlist"]
# Engine locale (i18n/<code>.json) -> the .lproj name macOS matches against the user's languages.
ENGINE_TO_LPROJ = {"en-US": "en", "ja-JP": "ja", "ko-KR": "ko", "zh-TW": "zh-Hant"}
CJK = ("ja", "zh-Hant")

errors = []
def fail(msg): errors.append(msg)

def load(path):
    out = subprocess.run(["plutil", "-convert", "json", "-o", "-", path], capture_output=True, text=True)
    if out.returncode != 0:
        fail(f"{path}: plutil cannot parse it ({out.stderr.strip() or out.stdout.strip()})")
        return {}
    return json.loads(out.stdout)

def specifiers(s):
    return sorted(re.findall(r"%(?:\d+\$)?[@dDuUxXoOfeEgGcCsSpaAF]", s))

def main():
    shipped = len(sys.argv) > 1
    root = os.path.join(sys.argv[1], "Contents", "Resources") if shipped else os.path.join(MAC, "Localization")
    found = sorted(os.path.basename(p)[:-6] for p in glob.glob(os.path.join(root, "*.lproj")))

    engine = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(REPO, "i18n", "*.json")))
    unknown = [e for e in engine if e not in ENGINE_TO_LPROJ]
    if unknown:
        fail(f"the engine speaks {unknown}, which has no .lproj mapping here — add it to ENGINE_TO_LPROJ "
             f"and translate Localization/<lang>.lproj, or the menus will be English around a "
             f"{unknown[0]} editor")
    want = sorted(ENGINE_TO_LPROJ[e] for e in engine if e in ENGINE_TO_LPROJ)
    if found != want:
        fail(f"{root}: languages {found} != the engine's {want}")

    for table in TABLES:
        base = load(os.path.join(root, "en.lproj", f"{table}.strings"))
        for lang in found:
            if lang == "en":
                continue
            path = os.path.join(root, f"{lang}.lproj", f"{table}.strings")
            if not os.path.exists(path):
                fail(f"{path}: missing")
                continue
            other = load(path)
            for k in base:
                if k not in other:
                    fail(f"{lang}/{table}: missing {k!r}")
                elif specifiers(base[k]) != specifiers(other[k]):
                    fail(f"{lang}/{table}: {k!r} has {specifiers(other[k])}, English has {specifiers(base[k])}")
            for k in other:
                if k not in base:
                    fail(f"{lang}/{table}: {k!r} is not in English (stale, or a typo in the key)")
            if lang in CJK:
                for k, v in other.items():
                    if re.search(r"——|──|—|\.\.\.", v) or re.search(r"[　-鿿＀-￯][,;:!?()]|[,;:!?(][　-鿿]", v):
                        fail(f"{lang}/{table}: {k!r} → {v!r} uses half-width punctuation or a dash next to CJK")

    if shipped:
        import plistlib
        info = plistlib.load(open(os.path.join(sys.argv[1], "Contents", "Info.plist"), "rb"))
        declared = sorted(info.get("CFBundleLocalizations", []))
        if declared != found:
            fail(f"Info.plist CFBundleLocalizations {declared} != the .lproj folders shipped {found}")
    else:
        base = load(os.path.join(root, "en.lproj", "Localizable.strings"))
        used, bare = set(), []
        for path in glob.glob(os.path.join(MAC, "Sources", "**", "*.swift"), recursive=True):
            src = open(path, encoding="utf-8").read()
            for m in re.finditer(r'\bL\(\s*"((?:[^"\\]|\\.)*)"', src):
                used.add(m.group(1).encode().decode("unicode_escape").encode("latin-1").decode("utf-8"))
            for n, line in enumerate(src.splitlines(), 1):
                code = line.split("//", 1)[0]
                if re.search(r'\b(withTitle|title):\s*"[^"]*[A-Za-z]', code) or \
                   re.search(r'(NSLocalizedDescriptionKey|NSLocalizedRecoverySuggestionErrorKey|wrappingLabelWithString):\s*"|\.title\s*=[^"]*(?<!L\()"[A-Za-z]', code):
                    bare.append(f"{os.path.relpath(path, MAC)}:{n}: {line.strip()}")
        for k in sorted(used - set(base)):
            fail(f"Sources use L({k!r}) but en.lproj/Localizable.strings has no such key")
        for k in sorted(set(base) - used):
            fail(f"en.lproj/Localizable.strings has {k!r}, which no Swift code uses any more")
        for b in bare:
            fail(f"user-visible literal that skips L(): {b}")

    if errors:
        print(f"✗ localization check failed ({root}):", file=sys.stderr)
        for e in errors:
            print("    " + e, file=sys.stderr)
        return 1
    print(f"✓ localizations {', '.join(found)} agree ({root})")
    return 0

sys.exit(main())

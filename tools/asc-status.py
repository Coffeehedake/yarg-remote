#!/usr/bin/env python
"""Read-only App Store Connect status for YARG Remote: builds, TestFlight state, groups, testers.

    C:\\dev\\adhd-nagger\\server\\.venv\\Scripts\\python.exe tools\\asc-status.py

Needs `op` enabled in the shell first:

    . C:\\dev\\_environment\\enable-headless-op.ps1

GETs only - it cannot submit, expire or change anything. Signs an ES256 JWT from the App Store
Connect key held in memory, and prints no secrets.

This exists because "the Codemagic step was green" and "Apple has the build" are different claims,
and "Apple has the build" and "a tester can install it" are different again. The field that decides
the third one is buildBetaDetail.internalBuildState: a build can be VALID and still be invisible in
TestFlight because export compliance was never answered, or because no tester is attached to it.
Adapted from adhd-nagger/scripts/asc-status.py, which is pinned to a different app id.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time

import httpx
import jwt

VAULT = "Home-Lab"
ASC_ITEM = "nullpointer - App Store Connect API (manager)"
APP_ID = "6829091050"                      # YARG Remote
BASE = "https://api.appstoreconnect.apple.com/v1"


def client() -> httpx.Client:
    out = subprocess.run(["op", "item", "get", ASC_ITEM, "--vault", VAULT, "--format", "json"],
                         capture_output=True, text=True, check=True).stdout
    f = {x.get("label"): x.get("value") for x in json.loads(out)["fields"]}
    now = int(time.time())
    token = jwt.encode({"iss": f["Issuer ID"].strip(), "iat": now, "exp": now + 600,
                        "aud": "appstoreconnect-v1"},
                       f["Private Key"].replace("\r\n", "\n").strip() + "\n",
                       algorithm="ES256", headers={"kid": f["Key ID"].strip(), "typ": "JWT"})
    return httpx.Client(timeout=30, headers={"Authorization": f"Bearer {token}"})


def get(c: httpx.Client, path: str, **params):
    r = c.get(f"{BASE}{path}", params=params)
    if r.status_code != 200:
        print(f"  GET {path} -> HTTP {r.status_code}: {r.text[:200]}")
        return None
    return r.json()


def main() -> int:
    c = client()

    app = get(c, f"/apps/{APP_ID}")
    if app is None:
        return 2
    a = app["data"]["attributes"]
    print(f"app: {a.get('name')}  bundle={a.get('bundleId')}  sku={a.get('sku')}")

    print("\n--- builds (newest first) ---")
    builds = get(c, "/builds", **{"filter[app]": APP_ID, "limit": 10,
                                  "sort": "-uploadedDate"})
    if not builds or not builds["data"]:
        print("  NO BUILDS AT ALL")
        return 0

    for b in builds["data"]:
        ba = b["attributes"]
        print(f"  build {ba.get('version')}  id={b['id']}")
        print(f"    processingState={ba.get('processingState')}  expired={ba.get('expired')}  "
              f"uploaded={ba.get('uploadedDate')}")
        print(f"    minOsVersion={ba.get('minOsVersion')}  "
              f"usesNonExemptEncryption={ba.get('usesNonExemptEncryption')}")

        # THE field that decides whether a tester can see it.
        d = get(c, f"/builds/{b['id']}/buildBetaDetail")
        if d and d.get("data"):
            da = d["data"]["attributes"]
            print(f"    internalBuildState={da.get('internalBuildState')}  "
                  f"externalBuildState={da.get('externalBuildState')}  "
                  f"autoNotifyEnabled={da.get('autoNotifyEnabled')}")

        g = get(c, f"/builds/{b['id']}/betaGroups")
        names = [x["attributes"].get("name") for x in (g or {}).get("data", [])]
        print(f"    beta groups on this build: {names if names else 'NONE'}")

    print("\n--- beta groups on the app ---")
    groups = get(c, f"/apps/{APP_ID}/betaGroups", limit=20)
    if not groups or not groups["data"]:
        print("  NO BETA GROUPS - nobody can be assigned a build")
    else:
        for g in groups["data"]:
            ga = g["attributes"]
            t = get(c, f"/betaGroups/{g['id']}/betaTesters", limit=50)
            n = len((t or {}).get("data", []))
            print(f"  '{ga.get('name')}'  internal={ga.get('isInternalGroup')}  "
                  f"publicLink={ga.get('publicLinkEnabled')}  testers={n}")
            for x in (t or {}).get("data", [])[:10]:
                xa = x["attributes"]
                print(f"      - {xa.get('email')}  state={xa.get('state')}")

    print("\n--- app-level beta testers ---")
    testers = get(c, "/betaTesters", **{"filter[apps]": APP_ID, "limit": 50})
    data = (testers or {}).get("data", [])
    if not data:
        print("  NONE - no tester is attached to this app at all")
    for x in data:
        xa = x["attributes"]
        print(f"  {xa.get('email')}  {xa.get('firstName')} {xa.get('lastName')}  state={xa.get('state')}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

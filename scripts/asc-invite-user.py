#!/usr/bin/env python
"""Invite a person to the App Store Connect team so they can be an INTERNAL TestFlight tester.

    C:\\dev\\adhd-nagger\\server\\.venv\\Scripts\\python.exe scripts\\asc-invite-user.py

Needs `op` enabled first:  . C:\\dev\\_environment\\enable-headless-op.ps1

THIS SENDS AN EMAIL to the person named below and grants them access to the developer account.
Run it only when that is the intention.

Least privilege, on purpose:
  * role MARKETING - the least privileged of the four roles Apple allows to be an internal
    tester (Admin, App Manager, Developer, Marketing). There is no TestFlight-only role.
  * allAppsVisible = False, visibleApps = [YARG Remote] - they see this app and nothing else.
  * provisioningAllowed = False - no access to certificates, identifiers or profiles.

The invitation is PENDING until accepted with an Apple ID matching the email. They cannot be
added to the internal group before that; run asc-add-internal.py once they have accepted.
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
APP_ID = "6829091050"
BASE = "https://api.appstoreconnect.apple.com/v1"

INVITEE = {"email": "justin.alan.burgess@gmail.com",
           "firstName": "Justin", "lastName": "Burgess"}
ROLES = ["MARKETING"]


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


def main() -> int:
    c = client()

    # Do not send a second invitation to someone who already has one pending.
    r = c.get(f"{BASE}/userInvitations", params={"limit": 50})
    if r.status_code == 200:
        pending = {u["attributes"]["email"].lower(): u for u in r.json()["data"]}
        print(f"pending invitations: {list(pending) if pending else 'none'}")
        if INVITEE["email"].lower() in pending:
            a = pending[INVITEE["email"].lower()]["attributes"]
            print(f"  ALREADY INVITED: roles={a.get('roles')} expires={a.get('expirationDate')}")
            print("  not sending a second invitation")
            return 0
    else:
        print(f"  GET /userInvitations -> HTTP {r.status_code}")

    r = c.get(f"{BASE}/users", params={"limit": 50})
    if r.status_code == 200:
        existing = [u["attributes"]["username"].lower() for u in r.json()["data"]]
        if INVITEE["email"].lower() in existing:
            print("  ALREADY A TEAM MEMBER - nothing to invite")
            return 0

    body = {"data": {"type": "userInvitations",
                     "attributes": {**INVITEE,
                                    "roles": ROLES,
                                    "allAppsVisible": False,
                                    "provisioningAllowed": False},
                     "relationships": {"visibleApps":
                                       {"data": [{"type": "apps", "id": APP_ID}]}}}}
    r = c.post(f"{BASE}/userInvitations", json=body)
    print(f"POST /userInvitations {INVITEE['email']}: HTTP {r.status_code}")
    if r.status_code not in (200, 201):
        try:
            for e in r.json().get("errors", []):
                print(f"  {e.get('code')}: {e.get('title')} - {e.get('detail','')[:300]}")
        except Exception:
            print(f"  {r.text[:400]}")
        return 3

    a = r.json()["data"]["attributes"]
    print(f"  invited: {a.get('email')}  roles={a.get('roles')}  "
          f"allAppsVisible={a.get('allAppsVisible')}  expires={a.get('expirationDate')}")
    print("\nPENDING until they accept with an Apple ID for that address.")
    print("Then run asc-add-internal.py to put them in the Internal group.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

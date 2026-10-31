#!/usr/bin/env python3
"""Re-apply the native edits YARG Remote needs after `npx cap add ios|android`.

ios/ and android/ are generated and gitignored, so these edits cannot live in a diff: CI
regenerates both on every build and runs this afterwards (see codemagic.yaml). It is the same
shape as adhd-nagger's ios_native_setup.py and shopstack-mobile's *_msal_setup.py.

WHAT IT DOES, and why each edit is not optional:

  iOS (ios/App/App/Info.plist)
    NSAppTransportSecurity.NSAllowsLocalNetworking = true
        The game's console is plain HTTP on a home LAN: there is no certificate to get, because
        the address is a private IP that changes per party. Without this, iOS refuses every
        request, and the app reports "Nothing answered" for a console that is answering.
        This is narrower than NSAllowsArbitraryLoads, which would permit cleartext everywhere.
    NSLocalNetworkUsageDescription
        iOS 14+ asks permission before an app talks to the local network, and shows this string.
        Missing, the request is refused with no prompt.
    ITSAppUsesNonExemptEncryption = false
        The app uses no encryption of its own. Without the key App Store Connect holds every
        TestFlight build at "Missing Compliance" until somebody answers a questionnaire by hand.

  Android (android/app/src/main/{res/xml/network_security_config.xml, AndroidManifest.xml})
    A network-security-config permitting cleartext, referenced from <application>.
        Since Android 9 cleartext HTTP is refused by default, and CapacitorHttp goes through the
        platform's HTTP stack, so the same console is unreachable without this.
        NOTE THE LIMIT. The README used to say "cleartext to private ranges". Android's
        network-security-config matches HOSTNAMES, not CIDR ranges, and the user types an
        arbitrary LAN IP, so a private-range allowance cannot be written. What this does is
        permit cleartext for the whole app (a <base-config>), which is equivalent to
        usesCleartextTraffic=true; what keeps that acceptable is that the app talks only to the
        address the user typed. It is the same exposure the README called "the lazier option",
        and it is stated here rather than hidden.

Every edit is IDEMPOTENT (run it twice, get the same files) and the script FAILS LOUDLY when the
generated project is not the shape it expects, so a Capacitor upgrade cannot quietly ship a build
whose app can reach nothing.

  python3 scripts/native_setup.py ios     [--ios-dir ios]
  python3 scripts/native_setup.py android [--android-dir android]
"""

from __future__ import annotations

import argparse
import plistlib
import re
import sys
from pathlib import Path

LOCAL_NETWORK_TEXT = (
    "YARG Remote talks to the game running on your computer, on this network, "
    "so you can search the library and queue songs."
)

NETWORK_SECURITY_CONFIG = """<?xml version="1.0" encoding="utf-8"?>
<!--
  Written by scripts/native_setup.py. Cleartext HTTP is permitted because the game's console is
  plain HTTP on a home LAN. See that script for why this is app-wide and not private-range only.
-->
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
"""

MANIFEST_ATTRIBUTE = 'android:networkSecurityConfig="@xml/network_security_config"'


class SetupError(Exception):
    """The generated project is not the shape this script expects."""


# --------------------------------------------------------------------------- iOS


def apply_ios(info_plist: Path) -> list[str]:
    """Edit an Info.plist in place. Returns a human-readable list of what changed."""
    if not info_plist.is_file():
        raise SetupError(f"{info_plist} does not exist - did `npx cap add ios` run?")

    try:
        plist = plistlib.loads(info_plist.read_bytes())
    except Exception as error:  # plistlib raises a zoo of types
        raise SetupError(f"{info_plist} is not a readable plist: {error}") from error

    if "CFBundleIdentifier" not in plist:
        raise SetupError(f"{info_plist} has no CFBundleIdentifier - not an app Info.plist")

    changes: list[str] = []

    ats = plist.get("NSAppTransportSecurity")
    if ats is None:
        ats = {}
    if not isinstance(ats, dict):
        raise SetupError("NSAppTransportSecurity is present but is not a dictionary")
    if ats.get("NSAllowsLocalNetworking") is not True:
        ats["NSAllowsLocalNetworking"] = True
        plist["NSAppTransportSecurity"] = ats
        changes.append("NSAppTransportSecurity.NSAllowsLocalNetworking = true")

    if plist.get("NSLocalNetworkUsageDescription") != LOCAL_NETWORK_TEXT:
        plist["NSLocalNetworkUsageDescription"] = LOCAL_NETWORK_TEXT
        changes.append("NSLocalNetworkUsageDescription")

    if plist.get("ITSAppUsesNonExemptEncryption") is not False:
        plist["ITSAppUsesNonExemptEncryption"] = False
        changes.append("ITSAppUsesNonExemptEncryption = false")

    if changes:
        info_plist.write_bytes(plistlib.dumps(plist, fmt=plistlib.FMT_XML, sort_keys=False))
    return changes


# ----------------------------------------------------------------------- Android


def apply_android(android_dir: Path) -> list[str]:
    """Write the network-security-config and reference it from the manifest."""
    main = android_dir / "app" / "src" / "main"
    manifest = main / "AndroidManifest.xml"
    if not manifest.is_file():
        raise SetupError(f"{manifest} does not exist - did `npx cap add android` run?")

    text = manifest.read_text(encoding="utf-8")
    application = re.search(r"<application\b", text)
    if application is None:
        raise SetupError(f"{manifest} has no <application> element")

    changes: list[str] = []

    config = main / "res" / "xml" / "network_security_config.xml"
    config.parent.mkdir(parents=True, exist_ok=True)
    if not config.is_file() or config.read_text(encoding="utf-8") != NETWORK_SECURITY_CONFIG:
        config.write_text(NETWORK_SECURITY_CONFIG, encoding="utf-8")
        changes.append("res/xml/network_security_config.xml")

    existing = re.search(r'android:networkSecurityConfig="([^"]*)"', text)
    if existing is None:
        text = text[: application.end()] + f" {MANIFEST_ATTRIBUTE}" + text[application.end():]
        manifest.write_text(text, encoding="utf-8")
        changes.append("AndroidManifest.xml: android:networkSecurityConfig")
    elif existing.group(1) != "@xml/network_security_config":
        raise SetupError(
            f"AndroidManifest.xml already sets networkSecurityConfig to {existing.group(1)!r}; "
            "refusing to overwrite something this script did not write"
        )

    # Verify the result rather than trusting the edit.
    if MANIFEST_ATTRIBUTE not in manifest.read_text(encoding="utf-8"):
        raise SetupError("the manifest edit did not take")
    return changes


# --------------------------------------------------------------------------- main


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="platform", required=True)
    ios = sub.add_parser("ios")
    ios.add_argument("--ios-dir", default="ios", type=Path)
    android = sub.add_parser("android")
    android.add_argument("--android-dir", default="android", type=Path)
    args = parser.parse_args(argv)

    try:
        if args.platform == "ios":
            changes = apply_ios(args.ios_dir / "App" / "App" / "Info.plist")
        else:
            changes = apply_android(args.android_dir)
    except SetupError as error:
        print(f"native_setup: FAILED: {error}", file=sys.stderr)
        return 1

    print(f"native_setup ({args.platform}): " + ("; ".join(changes) if changes else "already applied, nothing to change"))
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Tests for native_setup.py. Run: python -m unittest discover -s scripts -p "test_*.py" -v

The script edits generated native projects in CI, where a mistake costs a build and, worse, can
ship an app that reaches nothing. So the failure paths are tested as hard as the success paths.
"""

from __future__ import annotations

import plistlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import native_setup as ns  # noqa: E402

MINIMAL_PLIST = {
    "CFBundleIdentifier": "com.badassium.yargremote",
    "CFBundleName": "YARG Remote",
    "UILaunchStoryboardName": "LaunchScreen",
}

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:label="@string/app_name">
        <activity android:name=".MainActivity" />
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
"""


class IosTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.plist = Path(self.tmp.name) / "Info.plist"

    def write(self, data: dict) -> None:
        self.plist.write_bytes(plistlib.dumps(data))

    def read(self) -> dict:
        return plistlib.loads(self.plist.read_bytes())

    def test_adds_all_three_keys(self) -> None:
        self.write(MINIMAL_PLIST)
        changes = ns.apply_ios(self.plist)
        result = self.read()
        self.assertIs(result["NSAppTransportSecurity"]["NSAllowsLocalNetworking"], True)
        self.assertEqual(result["NSLocalNetworkUsageDescription"], ns.LOCAL_NETWORK_TEXT)
        self.assertIs(result["ITSAppUsesNonExemptEncryption"], False)
        self.assertEqual(len(changes), 3)

    def test_does_not_widen_to_arbitrary_loads(self) -> None:
        # NSAllowsLocalNetworking is the narrow exception; the broad one must never appear.
        self.write(MINIMAL_PLIST)
        ns.apply_ios(self.plist)
        self.assertNotIn("NSAllowsArbitraryLoads", self.read()["NSAppTransportSecurity"])

    def test_keeps_everything_it_did_not_write(self) -> None:
        self.write({**MINIMAL_PLIST, "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"]})
        ns.apply_ios(self.plist)
        result = self.read()
        self.assertEqual(result["CFBundleName"], "YARG Remote")
        self.assertEqual(result["UISupportedInterfaceOrientations"], ["UIInterfaceOrientationPortrait"])

    def test_keeps_other_transport_security_keys(self) -> None:
        self.write({**MINIMAL_PLIST, "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": False}})
        ns.apply_ios(self.plist)
        ats = self.read()["NSAppTransportSecurity"]
        self.assertIs(ats["NSAllowsArbitraryLoads"], False)
        self.assertIs(ats["NSAllowsLocalNetworking"], True)

    def test_idempotent_and_byte_stable(self) -> None:
        self.write(MINIMAL_PLIST)
        ns.apply_ios(self.plist)
        first = self.plist.read_bytes()
        changes = ns.apply_ios(self.plist)
        self.assertEqual(changes, [])
        self.assertEqual(self.plist.read_bytes(), first)

    def test_corrects_a_wrong_encryption_flag(self) -> None:
        self.write({**MINIMAL_PLIST, "ITSAppUsesNonExemptEncryption": True})
        ns.apply_ios(self.plist)
        self.assertIs(self.read()["ITSAppUsesNonExemptEncryption"], False)

    def test_fails_on_missing_file(self) -> None:
        with self.assertRaises(ns.SetupError):
            ns.apply_ios(self.plist)

    def test_fails_on_garbage(self) -> None:
        self.plist.write_text("not a plist", encoding="utf-8")
        with self.assertRaises(ns.SetupError):
            ns.apply_ios(self.plist)

    def test_fails_when_it_is_not_an_app_plist(self) -> None:
        self.write({"SomethingElse": 1})
        with self.assertRaises(ns.SetupError):
            ns.apply_ios(self.plist)

    def test_fails_when_transport_security_is_the_wrong_type(self) -> None:
        self.write({**MINIMAL_PLIST, "NSAppTransportSecurity": "yes"})
        with self.assertRaises(ns.SetupError):
            ns.apply_ios(self.plist)


class AndroidTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.main = self.root / "app" / "src" / "main"
        self.main.mkdir(parents=True)
        self.manifest = self.main / "AndroidManifest.xml"
        self.config = self.main / "res" / "xml" / "network_security_config.xml"

    def test_writes_the_config_and_references_it(self) -> None:
        self.manifest.write_text(MANIFEST, encoding="utf-8")
        changes = ns.apply_android(self.root)
        self.assertEqual(self.config.read_text(encoding="utf-8"), ns.NETWORK_SECURITY_CONFIG)
        text = self.manifest.read_text(encoding="utf-8")
        self.assertIn(ns.MANIFEST_ATTRIBUTE, text)
        self.assertEqual(len(changes), 2)

    def test_the_attribute_lands_on_application_not_elsewhere(self) -> None:
        self.manifest.write_text(MANIFEST, encoding="utf-8")
        ns.apply_android(self.root)
        text = self.manifest.read_text(encoding="utf-8")
        self.assertEqual(text.count(ns.MANIFEST_ATTRIBUTE), 1)
        self.assertLess(text.index("<application"), text.index(ns.MANIFEST_ATTRIBUTE))
        self.assertLess(text.index(ns.MANIFEST_ATTRIBUTE), text.index("<activity"))

    def test_keeps_the_rest_of_the_manifest(self) -> None:
        self.manifest.write_text(MANIFEST, encoding="utf-8")
        ns.apply_android(self.root)
        text = self.manifest.read_text(encoding="utf-8")
        for kept in ('android:allowBackup="true"', "android.permission.INTERNET", ".MainActivity"):
            self.assertIn(kept, text)

    def test_idempotent_and_byte_stable(self) -> None:
        self.manifest.write_text(MANIFEST, encoding="utf-8")
        ns.apply_android(self.root)
        first = self.manifest.read_bytes()
        changes = ns.apply_android(self.root)
        self.assertEqual(changes, [])
        self.assertEqual(self.manifest.read_bytes(), first)

    def test_repairs_a_missing_config_file(self) -> None:
        self.manifest.write_text(MANIFEST, encoding="utf-8")
        ns.apply_android(self.root)
        self.config.unlink()
        changes = ns.apply_android(self.root)
        self.assertEqual(len(changes), 1)
        self.assertTrue(self.config.is_file())

    def test_refuses_to_overwrite_a_different_config(self) -> None:
        # Something else set it. Replacing it would be this script deciding it knows better.
        self.manifest.write_text(MANIFEST.replace("<application", '<application android:networkSecurityConfig="@xml/other"'), encoding="utf-8")
        # The MESSAGE matters, not just the exception type: the script's own final self-check
        # also raises SetupError, so a bare assertRaises passed with this guard removed (a
        # surviving mutant, found 2026-10-30) - for the wrong reason.
        with self.assertRaisesRegex(ns.SetupError, "refusing to overwrite"):
            ns.apply_android(self.root)
        self.assertIn("@xml/other", self.manifest.read_text(encoding="utf-8"))  # and it left it alone

    def test_fails_on_missing_manifest(self) -> None:
        with self.assertRaises(ns.SetupError):
            ns.apply_android(self.root)

    def test_fails_without_an_application_element(self) -> None:
        self.manifest.write_text("<manifest></manifest>", encoding="utf-8")
        with self.assertRaises(ns.SetupError):
            ns.apply_android(self.root)

    def test_config_permits_cleartext_and_trusts_only_the_system(self) -> None:
        # Not a private-range allowance - Android cannot express one - and not a custom trust store.
        self.assertIn('cleartextTrafficPermitted="true"', ns.NETWORK_SECURITY_CONFIG)
        self.assertIn('<certificates src="system" />', ns.NETWORK_SECURITY_CONFIG)
        self.assertNotIn('src="user"', ns.NETWORK_SECURITY_CONFIG)


class CommandLineTests(unittest.TestCase):
    def test_exit_status_is_nonzero_on_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(ns.main(["ios", "--ios-dir", str(Path(tmp) / "missing")]), 1)
            self.assertEqual(ns.main(["android", "--android-dir", str(Path(tmp) / "missing")]), 1)

    def test_exit_status_is_zero_on_success(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            info = Path(tmp) / "App" / "App" / "Info.plist"
            info.parent.mkdir(parents=True)
            info.write_bytes(plistlib.dumps(MINIMAL_PLIST))
            self.assertEqual(ns.main(["ios", "--ios-dir", tmp]), 0)


if __name__ == "__main__":
    unittest.main()

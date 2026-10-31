# Building the phone apps

Written 2026-10-30, mid-task, so the reasoning survives a compaction. **Nothing in here has been run on
Codemagic.** The repo-side files exist and are tested; everything that touches an outside account is
still to do and is listed under "What has to exist first".

## The instruction, and what it settled

Jay: *"build it the same way we build shopstack mobile and the adhd nagging app."* So this does NOT use a
local Android Studio / Xcode flow. Both of those apps are built by **Codemagic** from a `codemagic.yaml`,
and this repo follows them. (Checked on this machine first: JDK 21 and adb exist, but there is no Android
SDK, no Gradle, no Mac; iOS cannot be built on Windows at all. A local Android build would have meant
~300 MB of SDK downloads and accepting Google's licences, and would still not have produced iOS.)

Prior art, read in full before writing anything (paths on ENG-1):

| | |
|---|---|
| `C:\dev\adhd-nagger\codemagic.yaml` + `CLAUDE.md` (search "Codemagic (2026-10-14)") | **Closest model.** Personal project, personal Apple account, iOS -> TestFlight. Holds the setup log and the pitfalls |
| `C:\dev\shopstack-mobile\codemagic.yaml` | The Android signed-release-APK workflow, and the iOS one it was modelled on |
| `C:\dev\shopstack-mobile\README.md` "Codemagic setup" | The one-time setup list |

**Personal-project rule (adhd-nagger's CLAUDE.md):** nothing Juniper. No `shopstack_signing` group, no
`com.juniperdesign` bundle id, no `@juniperdesign.com` recipients. YARG Remote is a FatalException/personal
project, so it follows adhd-nagger, not ShopStack, for identity.

## What is done (committed in this repo)

- `scripts/native_setup.py` + `scripts/test_native_setup.py` (21 tests). Re-applies, after `cap add`, the
  native edits the app cannot work without. **Verified against real `cap add ios` / `cap add android` output**
  on this machine: the plist keys and manifest attribute land correctly, a second run changes nothing, the
  generated `ios/` and `android/` stay gitignored.
- `codemagic.yaml`: an `ios-testflight` workflow (15 steps, adhd-nagger's shape) and an `android` workflow
  (8 steps, ShopStack's signing recipe). It parses. It has never run.

### The native edits, and one README claim that was wrong

- iOS: `NSAllowsLocalNetworking`, `NSLocalNetworkUsageDescription`, `ITSAppUsesNonExemptEncryption=false`.
- Android: a network-security-config permitting cleartext, referenced from `<application>`.
- **The README said Android would permit cleartext "to private ranges only". That cannot be written.**
  Android's network-security-config matches hostnames, not CIDR ranges, and the user types an arbitrary
  LAN IP. What the script does is permit cleartext app-wide, which is equivalent to
  `usesCleartextTraffic=true` - the thing the README called "the lazier option". What makes it acceptable is
  that the app only talks to the address the user typed. (From Android's documented behaviour; not
  verified on a device, because there is no device.)

## What has to exist first (NOT done - each one is outward-facing or a credential)

In order. Items 1-2 are Apple's side and are Jay's to do; the rest were done by hand/API for adhd-nagger.

1. **Apple**: register the bundle id `com.fatalexception.yargremote` (it is already `appId` in
   `capacitor.config.ts`; adhd-nagger used `com.badassium.*` - a naming decision for Jay) and create the
   **App Store Connect app record**. `app-store-connect publish` cannot create the record.
2. **Codemagic app** in Jay's personal account on the **generic git provider**, `settingsSource=file`,
   cloning GitLab project **57** (`fatalexception/yarg-remote`) with a **read-only GitLab deploy token**
   (adhd-nagger: project 64, token in 1Password `ADHD Nagger Codemagic Deploy Token`). Needs the 1Password
   item `CodeMagic API Token`.
3. **Variable group `yargremote_signing`**, created through the Codemagic API from 1Password values
   **without printing them**, stored `secure`:
   - iOS: the personal team's ASC key (1Password `nullpointer - App Store Connect API (manager)`, key id
     `4U4VWS2CD9`) and `CERTIFICATE_PRIVATE_KEY` (1Password `NullPointer iOS Signing Cert Key`). Reuse is
     deliberate - a second key mints a second Apple Distribution certificate against the 2-cert limit.
     (Open question: whether the existing `adhdnagger_signing` group can simply be referenced instead.)
   - Android: a **new keystore** (`keytool` from JDK 21 is on this machine), base64 in the group, and a
     copy in 1Password. **Losing it means phones cannot upgrade in place.**
4. **GitLab webhook** on project 57 -> `https://api.codemagic.io/hooks/<app id>` (push, tag push, merge
   request; SSL verification on). Needs the api-scoped token in 1Password `GitLab-CE (Personal)`.
   adhd-nagger's is hook 51. **Until it exists a push builds nothing; once it exists every push to main
   spends build minutes on both workflows** (the changeset filter skips docs-only pushes).
5. First build: trigger through the API, expect to iterate.

## Pitfalls other people already paid for (adhd-nagger CLAUDE.md)

- **A green Codemagic step is not proof Apple has the build.** Verify from App Store Connect
  (`scripts/asc-status.py` in adhd-nagger). Apple takes ~5 minutes to list a build after upload.
- **Artifact paths are relative to `working_directory`** (not an issue here - the app is at the repo root).
- **A push can cancel a queued build** (`cancel_previous_builds`), and the changeset filter accumulates until a
  build SUCCEEDS - look for the newest build number, not the one matching your commit.
- **A build the webhook skips still appears in the list**, so "a build ran" is not "a build shipped".
- Real build errors are in the `App.log` artifact, not the step log.
- The first build of a marketing version may need a full TestFlight review for EXTERNAL testers; internal
  testers never wait.

## Still unverified, and open

- The whole pipeline. In particular nothing has compiled this app in Xcode or Gradle.
- **No app icon source** (`assets/icon-only.png`, 1024x1024 RGB, no alpha). The workflows skip icon
  generation when it is absent and ship Capacitor's placeholder. Do **not** use the upstream YARG logo.
- The iOS bundle id / Apple-side naming, and whether to reuse `adhdnagger_signing`.
- Whether the app works on a real phone at all: the native HTTP stack, the cleartext exceptions, touch
  and layout. Everything so far is the web layer driven in a browser against the real game.
- The game must be set to **LAN** for a phone to reach it; the game now shows the address to type.

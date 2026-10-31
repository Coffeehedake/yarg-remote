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

1. **Apple.**
   - **DONE 2026-10-30: bundle id `com.badassium.yargremote` is registered** (name "YARG Remote", platform
     Universal, Apple id `8B7253AXDJ`): `POST /v1/bundleIds` returned 201 and a separate read-back confirmed it,
     using the personal team's App Store Connect key (1Password `nullpointer - App Store Connect API (manager)`,
     vault Home-Lab). That key's role CAN create identifiers - it was not known beforehand.
     The id follows the account's convention: personal apps are `com.badassium.*` (adhdnagger, nullpointer), the
     company app is `com.juniperdesign.*`, nothing used `com.fatalexception.*`. `capacitor.config.ts` and
     `codemagic.yaml` were changed from `com.fatalexception.yargremote` to match. Read-only discovery first showed
     neither candidate was registered and that three app records existed, none for this app.
   - **DONE 2026-10-30, by Jay in the App Store Connect web UI: the app record exists.** Apple has no API for
     creating one. Name "YARG Remote", iOS, English (U.S.), bundle id above, SKU `yarg-remote-1` (permanent),
     **ASC app id `6829091050`**. Confirmed afterwards through Apple's API (`GET /v1/apps`), not from the page.
     The store page is empty on purpose - TestFlight needs only the record. NOTE: YARG is YARC's trademark;
     irrelevant for TestFlight, not for a public release.
   - The App Store Connect "Developer Program License Agreement updated" banner was showing earlier and was gone
     by the time the form opened; Jay is the one who would have accepted it. It said existing apps could not be
     updated until it was - worth remembering if a TestFlight upload ever fails for an unexplained reason.
2. **Codemagic app** in Jay's personal account on the **generic git provider**, `settingsSource=file`,
   cloning GitLab project **57** (`fatalexception/yarg-remote`) with a **read-only GitLab deploy token**
   (adhd-nagger: project 64, token in 1Password `ADHD Nagger Codemagic Deploy Token`). Needs the 1Password
   item `CodeMagic API Token`.
   **Step 2 findings (2026-10-30, read-only `GET /apps`, secrets redacted):** the three existing apps are registered
   three ways. adhd-nagger (API, `POST /apps`): `provider=generic`, and the raw `repository.htmlUrl` **embeds a GitLab
   deploy token**, with the auth fields empty. nullpointer (UI): `generic`, clean URL, separate auth (`username=codemagic-ci`,
   `isAuthenticationEnabled=true`). shopstack-mobile: `provider=github`, no credentials. All three have
   `settingsSource=file`. **Codemagic's `GET /apps` returns an embedded token in clear**, so anyone holding the Codemagic
   API token can read adhd-nagger's. Options for this repo: (1) the PUBLIC GitHub mirror, no credential - but the mirror
   can lag a push, so trigger builds by API after checking `git ls-remote` matches rather than trusting a webhook;
   (2) a token in the URL via the API (readable afterwards); (3) a token in separate auth fields via the Codemagic UI
   (Jay pastes it). The documented `POST /apps` takes only `repositoryUrl` (+ optional `teamId`); credentials for a
   private HTTPS repo are not documented there.
   **DONE 2026-10-31, by Jay in the Codemagic UI (option 3): the app exists. App id `6ae62d7b737e54b5b3f6b3bc`.**
   Verified afterwards with a read-only `GET /apps` that printed only whitelisted fields: `provider=generic`,
   `settingsSource=file`, `projectType=ionic`, `repository.username=codemagic-ci`, `isAuthenticationEnabled=true`,
   the URL carries no credentials, and the app's JSON contains no `gldt-` and no `glpat-`. Codemagic can read the
   repo - its settings page renders this repo's own `codemagic.yaml`. `ionic` was chosen because Capacitor is
   Ionic's tooling and `Other` demands a free-text answer; with `settingsSource=file` the project type only picks
   which editor template the UI offers, so it is cosmetic.
   **Two things cost a round trip each.** (a) The first submit failed with `remote: HTTP Basic: Access denied`.
   The deploy token was NOT at fault - `git ls-remote` with it returned `main` at `81682ff` - but the Password
   field held a 14-character value that did not start with `gldt-`, almost certainly the 1Password browser
   extension autofilling a saved password into a field labelled "Password". The token is 25 chars and starts
   `gldt-`, so measure the field's LENGTH before submitting (`input[type=password].value.length`) rather than
   trusting the dots. (b) The wizard dialog closes on a stray click or Escape and silently discards everything
   typed into it, with no warning and nothing created.
   **A third finding, about adhd-nagger rather than this repo:** on 2026-10-31 the Codemagic apps page raised an
   unprompted success toast reading ``Successfully connected to https://codemagic-ci:<TOKEN>@gitlab.badassium.com/
   fatalexception/adhd-nagger.git`` with the deploy token **in clear text**. So a URL-embedded token leaks through
   the web UI as well as through `GET /apps` - the case for option 3, now measured twice and in two places. Sent
   to the live adhd-nagger session over Arbiter; that repo's registration is its own to fix, and rotating its
   token is Jay's call.
3. **Variable group `yargremote_signing`**, created through the Codemagic API from 1Password values
   **without printing them**, stored `secure`:
   - iOS: the personal team's ASC key (1Password `nullpointer - App Store Connect API (manager)`, key id
     `4U4VWS2CD9`) and `CERTIFICATE_PRIVATE_KEY` (1Password `NullPointer iOS Signing Cert Key`). Reuse is
     deliberate - a second key mints a second Apple Distribution certificate against the 2-cert limit.
     (Open question: whether the existing `adhdnagger_signing` group can simply be referenced instead.)
     **DONE 2026-10-31: the iOS half of the group exists.** Four variables created with
     `POST https://api.codemagic.io/apps/6ae62d7b737e54b5b3f6b3bc/variables`,
     body `{key, value, group: "yargremote_signing", secure: true}`, values read from 1Password in-process and
     never printed: `APP_STORE_CONNECT_ISSUER_ID` (36, uuid-shaped), `APP_STORE_CONNECT_KEY_IDENTIFIER` (10),
     `APP_STORE_CONNECT_PRIVATE_KEY` (257, PEM), `CERTIFICATE_PRIVATE_KEY` (1703, PEM). Each was length- and
     shape-checked before being sent, and refused if it carried a carriage return - CRLF contamination has
     corrupted a credential on this machine before. `GET /apps/<id>/variables` afterwards shows exactly one of
     each, `group=yargremote_signing`, `secure=true`.
     **Measured, and the opposite of the repository-URL behaviour: a `secure` variable is NOT readable back
     through the API.** All four return the same 8-character mask (identical sha256 across all four, matching
     none of the sources). So secrets in a variable group are safe from the Codemagic API in a way that a
     credential in `repositoryUrl` is not.
   - Android: a **new keystore** (`keytool` from JDK 21 is on this machine), base64 in the group, and a
     copy in 1Password. **Losing it means phones cannot upgrade in place.** NOT DONE - this is the other half
     of the group (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`), and the
     `android` workflow cannot run until it exists. The `ios-testflight` workflow does not need it.
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

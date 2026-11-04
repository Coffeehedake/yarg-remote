# Building the phone apps

Written 2026-10-30, mid-task, so the reasoning survives a compaction. It said "nothing in here has been run
on Codemagic" until 2026-10-31, when it was.

**STATUS 2026-10-31: BOTH pipelines work end to end, and pushes to `main` now build by themselves.**
`ios-testflight` ran green on its first attempt (build `6ae63b08f61b13a16adad68e`, all 19 steps) and App
Store Connect confirms build `1793473364`, `processingState=VALID`, not expired, minOS 15.0 - checked
against Apple's own API, not inferred from Codemagic's green upload step. The `android` workflow then ran
green too (build `6ae64816c09f10adde340a86`) and produced `app-release.apk`, 3,230,711 bytes, signed with
our own keystore - verified by parsing the APK's v2 signing block, not by trusting the step. **GitLab hook
52 now fires Codemagic on every push, tag push and merge request**, so from here a push costs build minutes
on both workflows and ships to TestFlight unless the changeset filter skips it.

This paragraph was wrong for part of the day: it claimed the Android workflow had never run, hours after it
had. A status line at the top of a file is read far more often than the step it summarises, so it is the
first thing to update, not the last.

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
     copy in 1Password. **Losing it means phones cannot upgrade in place.**
     **DONE 2026-10-31. The group is now complete: 7 variables, all `secure`, all `yargremote_signing`.**
     The keystore: PKCS12, alias `yargremote`, RSA 2048, SHA384withRSA, `CN=YARG Remote, O=FatalException, C=US`
     (personal identity - nothing Juniper), valid until 2054-03-18, 2656 bytes. Made with keytool 21.0.11 and
     `-storepass:env`/`-keypass:env`, so the password was never on a command line.
     **Where it lives, and the order that matters.** The password was generated INTO 1Password first
     (`op item create --generate-password='letters,digits,32'`, item `YARG Remote Android Keystore`, Home-Lab;
     username field = the alias, password field = both the store and key password, which is what
     `codemagic.yaml` assumes). Only then was the keystore made with it - so there was never a moment when a
     keystore existed whose password was not already stored. Alphanumeric on purpose: this value is passed to
     Gradle as `-Pandroid.injected.signing.*`.
     The FILE is a 1Password **document**, `YARG Remote Android Keystore (jks)`, uploaded with
     `op document create` (not a base64 field, so its contents never reached a command line). It was downloaded
     again and compared: **byte-identical, sha256 `5da049327f4d...`**. `ANDROID_KEYSTORE_BASE64` was checked to
     decode back to exactly those bytes before being sent. The local copy was then deleted; 1Password holds the
     only copy, which is the point.
     **If it is ever needed again:** `op document get "YARG Remote Android Keystore (jks)" --vault Home-Lab
     --out-file <path>`. Do not commit a `.jks` or that password, ever.
4. **GitLab webhook** on project 57 -> `https://api.codemagic.io/hooks/<app id>` (push, tag push, merge
   request; SSL verification on). adhd-nagger's is hook 51. **Until it exists a push builds nothing; once it
   exists every push to main spends build minutes on both workflows** (the changeset filter skips docs-only
   pushes).
   **DONE 2026-10-31. Hook 52**, created by `POST /projects/57/hooks` and read back: url
   `https://api.codemagic.io/hooks/6ae62d7b737e54b5b3f6b3bc`, push / tag push / merge request on,
   SSL verification on, pipeline and issue events off. A follow-up `GET /projects/57/hooks` confirms the
   project holds **exactly one** hook. The numeric id **57 is now measured**, not assumed, and the project's
   `default_branch` is `main`.
   **`GitLab-CE (Personal)` is NOT the credential for this.** Its password field is a 10-character password,
   not an API token, and using it returns 401. This step needed a token that did not exist yet: a **project
   access token**, `yarg-remote-api`, Maintainer, **`api` scope only**, expires 2027-10-30, created by Jay in
   the UI. It is in 1Password Home-Lab as **`YARG Remote GitLab API Token`** (field `credential`), and it can
   reach this one project and nothing else - which a personal PAT could not have said.
   Two things worth keeping about the token itself. It is **51 characters and contains dots**: GitLab's
   routable token format (17.7+) separates fields with `.`, so a validator written as
   `^glpat-[A-Za-z0-9_-]+$` rejects a perfectly good token - mine did, once. And the write was verified by
   **hash, not exit code**: 51 chars / sha256 `0d07ad30d980` going in, the same two numbers read back out.
5. First build: trigger through the API, expect to iterate.
   **DONE 2026-10-31, and it did NOT need iterating.** `POST https://api.codemagic.io/builds` with
   `{"appId":"6ae62d7b737e54b5b3f6b3bc","workflowId":"ios-testflight","branch":"main"}` and the `x-auth-token`
   header -> build `6ae63b08f61b13a16adad68e`. All 19 steps green in about three minutes, 2 artifacts. It built
   `origin/main` at `81682ff`, which is what Codemagic can see; local docs commits are irrelevant to it.
   **Verified at Apple, not from the green step:** `GET /v1/builds?filter[app]=6829091050` returns build
   `1793473364` (the epoch-seconds build number the yaml sets), `processingState=VALID`, `expired=false`,
   minOS 15.0, uploaded 2026-10-31T12:05:13-07:00. Internal testers can install it now.
   Two expectations that did NOT happen, recorded so nobody re-derives them: CocoaPods produced
   `App.xcworkspace` and the build used it, so Capacitor 8's SPM default (nullpointer's note) did not apply
   here; and the three-minute wall time is real, not a skipped build - Apple has the IPA.
   **The `android` workflow was then tried and FAILED INSTANTLY (build `6ae64541bcc5b55f67f22832`,
   2026-10-31): "The selected instance type is not available with the current billing plan."** Zero steps ran,
   zero artifacts, under a second. The cause was in this repo, not in the keystore or the variables: the
   workflow asked for `instance_type: linux_x2`, and this Codemagic plan does not include Linux instances.
   ShopStack's android workflow has always used `mac_mini_m2`; a comment in our `codemagic.yaml` dismissed that
   as habit and called Linux "the ordinary (and cheaper) choice". It was wrong - on this account a Mac instance
   is not the expensive option, it is the only one. Fixed to `mac_mini_m2`.
   That fix could not be tested until it was pushed - Codemagic clones `origin/main`, so a `codemagic.yaml`
   change sitting in a local commit changes nothing about what builds.
   **DONE 2026-10-31 after the push (`81682ff..ee34f88`): the `android` workflow is green too.** Build
   `6ae64816c09f10adde340a86` on `mac_mini_m2`, all 12 steps, about three minutes, one artifact:
   `app-release.apk`, 3,230,711 bytes. `cap add android` and `scripts/native_setup.py android` both ran on a
   real machine for the first time and did what they claim.
   **THE KEYSTORE IS PROVEN - the APK was checked, not the step name.** The artifact was downloaded (size
   matches the build record) and the signing certificate pulled out of it:
   `Owner: CN=YARG Remote, O=FatalException, C=US`, `Valid from: Sat Oct 31 15:14:25 EDT 2026 until:
   Wed Mar 18 15:14:25 EDT 2054`, SHA384withRSA, 2048-bit RSA. That validity window matches the keystore's
   creation timestamp **to the second**, which is what makes this our key and not merely a key.
   **App signing certificate SHA-256 (public - it is in every copy of the APK; this is the app's identity for
   in-place upgrades):**
   `21:30:D1:A7:49:E4:CC:9C:A8:AD:47:33:C9:70:08:EB:6D:66:F8:FD:44:13:3A:4C:48:55:2B:99:8B:D8:4C:11`
   **How to check it again, because the obvious tools do not work here.** The APK carries an **APK Signature
   Scheme v2 signature only** - no v1/JAR signature and no `META-INF/*.RSA`. So `keytool -printcert -jarfile`
   reports nothing, and `apksigner` is not installed on ENG-1 (no Android SDK). The certificate has to be read
   out of the APK Signing Block directly: `scripts/`-free helper in the session scratchpad,
   `extract_apk_cert.py`. One trap in that parsing: the v2 block's value is a length-prefixed **sequence** of
   length-prefixed signers, so there is one more nesting level than the layout suggests. Skipping it yields a
   264-byte "certificate" that keytool declines to print without an error, which is how the bug surfaced.

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

- ~~The whole pipeline.~~ **BOTH halves are now proven (2026-10-31).** Xcode compiled this app, produced an
  IPA and Apple accepted it; Gradle compiled it and produced a release APK signed with our own keystore,
  verified from the APK's own certificate rather than from a green step.
- ~~No push has yet gone through hook 52.~~ **The hook is PROVEN end to end (2026-10-31, 18:06 ET).** Pushing
  `ee34f88..de19944` produced a GitLab delivery logged **HTTP 202** and two Codemagic builds within seconds,
  with no API call from here.
  **And the changeset filter behaved exactly as this file claims**, which had never been watched before:
  iOS (`6ae666856a1999f83b5c6eff`) ran all 19 steps and uploaded to TestFlight, while Android
  (`6ae666856a1999f83b5c6f00`) came back **`status=skipped`** - "Preparing build machine" and "Fetching app
  sources" succeeded, every real step skipped, 0 artifacts.
  That asymmetry is the filter working, not failing: **it diffs against the last SUCCESSFUL build of that
  workflow, not against the previous commit.** iOS last succeeded at `81682ff`, and `ee34f88` changed
  `codemagic.yaml` (always in the changeset) in between, so iOS had a real change to build. Android last
  succeeded at `ee34f88`, and `ee34f88..de19944` is documentation only, so it had nothing. Expect a docs-only
  push to skip **only** for workflows that have succeeded since the last code change.
  GitLab records every delivery and its response under the project's Webhooks page, which is where to look if
  a push seems to build nothing.
- **Nobody has installed the TestFlight build on a phone.** A VALID build at Apple proves the pipeline, not
  the app: the native HTTP stack, the cleartext exception, touch and layout are all still unexercised on a
  device, and so is talking to the game.
- **No app icon source** (`assets/icon-only.png`, 1024x1024 RGB, no alpha). The workflows skip icon
  generation when it is absent and ship Capacitor's placeholder. Do **not** use the upstream YARG logo.
- The iOS bundle id / Apple-side naming, and whether to reuse `adhdnagger_signing`.
- Whether the app works on a real phone at all: the native HTTP stack, the cleartext exceptions, touch
  and layout. Everything so far is the web layer driven in a browser against the real game.
- The game must be set to **LAN** for a phone to reach it; the game now shows the address to type.

## TestFlight distribution: two API traps, measured 2026-11-03

Justin installed TestFlight and could not open the link he had been sent. Diagnosing it hit two
App Store Connect API behaviours that both produce confident wrong answers.

### `/builds/{id}/betaGroups` returns an empty list even when a group holds the build

Asked from the build's side, both builds reported **no groups**. That was written up as
"distribution was never set up, nobody can install anything" and reported as the cause. Asked
from the group's side a few minutes later:

```
'Internal' INTERNAL: 2 build(s)   1793484505 VALID, 1793473364 VALID
'Friends'  EXTERNAL: 2 build(s)   1793484505 VALID, 1793473364 VALID
```

Both groups held both builds the whole time, including the external group nothing had written to.
**Ask `GET /betaGroups/{id}/builds`, never `GET /builds/{id}/betaGroups`.** The reverse direction
is not a view of the same relationship.

The same mistake also made a write look necessary: a `POST` to
`/betaGroups/{id}/relationships/builds` returned **HTTP 204** for a build that was already there,
so "WROTE: build assigned" appeared in the log for a no-op. A 204 means Apple accepted the
request, not that anything changed - this project's own rule is to verify a write by reading the
state back, and that is the only reason the first version of this note was caught being wrong.

### An invitation's EXISTENCE is not its validity, and it blocks re-inviting

`GET /userInvitations` lists **expired** invitations with no flag saying so - only an
`expirationDate` to compare against the clock yourself. Justin's had expired three hours and
twenty minutes before anyone looked:

```
expires=2026-11-03T15:18:19.566-08:00   (checked at 2026-11-04T02:39Z - EXPIRED by 3h20m)
```

That is the whole of his problem. He had been invited, the seven-day window closed, and the link
he kept clicking was dead. A script that only asked "does an invitation exist for this email"
answered yes and declined to re-send - which is the instrument agreeing with the defect.

And it cannot be repaired through this API key:

| action | result |
|---|---|
| `DELETE /userInvitations/{id}` | **403** - user management needs Admin; this key is App Manager |
| `POST /userInvitations` | **409** `ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE`, "The email is already being used" |

The dead invitation holds the address, and the key may not remove it. **Resending an expired
invitation is a web-UI job:** App Store Connect -> Users and Access -> the pending invitation ->
Resend, or remove it and invite again. Role `MARKETING` is the least privileged one Apple accepts
for an internal tester (no code, no certificates, no build management); pair it with
`allAppsVisible: false` and a `visibleApps` relationship pinned to this app.

### The order the records have to be in

An internal tester needs all of these, and each is a separate resource that can be fine while
another is not:

1. the person is a **team member** (accepted invitation - the step above)
2. they are a **beta tester in an INTERNAL group** (Justin is only in the external `Friends`)
3. the **group holds a build** (both groups already do)

Internal testers never wait for Beta App Review. External ones do, and for this app that route is
also unattractive on its own terms: every field it needs is empty - no `betaAppLocalizations` at
all, and `betaAppReviewDetail` has null contact first name, last name, phone and email - and a
reviewer cannot exercise an app whose whole purpose is talking to a PC running YARG on the same
LAN, so it would need explanatory notes or a demo video.

### The invite loop was the wrong Apple ID, and two instruments lied on the way

Justin got the resent invitation, clicked it, signed in successfully, and landed back on the
login page. Endlessly.

**His Apple ID is not the address he was invited at.** The invitation was bound to
`justin.alan.burgess@gmail.com`; his Apple ID is a different address entirely. App Store Connect
authenticated him perfectly well, found no pending invitation for the account he had
authenticated *as*, and bounced him to login — with no error, because from Apple's side nothing
went wrong. Inviting his actual Apple ID fixed it.

**The symptom does not distinguish that from the other common cause**, which is an Apple ID
without two-factor authentication: App Store Connect requires 2FA, and an account lacking it also
signs in and loops with no error. The test that separates them takes a minute — sign in to
`appleid.apple.com` with the invited address. If it is not an Apple ID at all, it is the first
cause; if it signs in, check Sign-In and Security for 2FA. Worth doing on a computer rather than
a phone: the invite is a web account invitation, not a TestFlight link, and on iOS it bounces
between Safari and the App Store.

Two instrument failures while fixing it, both of the shape this project keeps meeting:

- **`POST /userInvitations` returned 201 and the list read back EMPTY.** The script reported "the
  send did not stick" and it had. Apple's `GET /userInvitations` lagged its own write by under a
  minute. This is the same family as the note in `WORKSPACE.md` about `git ls-remote` versus the
  GitHub REST API, where the repository record had not caught up with a push that had landed:
  **a read immediately after a write measures the read's freshness, not the write.** Retry before
  concluding, or verify from the resource the write returned.
- **A diagnostic script filtered invitations on `"justin" in email`.** The new address is
  `stewierulesoverbrian@gmail.com`, which contains no "justin", so the listing showed one
  invitation where there were two and appeared to confirm the false alarm above. A filter chosen
  from what the data looked like yesterday.

### There are TWO invitations, and accepting the first one shows nothing

Justin accepted the App Store Connect invitation, opened TestFlight, and found an empty screen
offering to "Redeem a code". Nothing was wrong; he was one step from the end and the screen in
front of him was the step.

**The account invitation and the tester invitation are separate.** The first makes someone a team
member — that is `POST /userInvitations`, and accepting it is what lets them into App Store
Connect. The second attaches an app to their TestFlight — that is
`POST /betaTesterInvitations` with `app` and `betaTester` relationships, and until it is redeemed
TestFlight has nothing to show, because opening TestFlight does not pull anything in.

The field that says which state somebody is in is on the group's tester list:

```
state=INVITED     the account is set up and TestFlight has nothing      <- Justin, before
state=INSTALLED   redeemed, the app is on the phone                     <- Justin, after
```

So when a tester says "TestFlight is empty", read `state` before anything else. `INVITED` means
send or resend `betaTesterInvitations`; the mail carries a redeem code that works in exactly the
box they are already looking at. Apple's TestFlight mail lands in spam often enough to be worth
saying out loud.

**And do not read anything into `/betaTesters/{id}/builds`.** It reported `builds=0` for Justin,
which looked like a smoking gun — and the control showed `builds=0` for the two testers who had
the app installed and working. Another relationship that answers nothing from that direction,
the same as `/builds/{id}/betaGroups` above. **Control every "zero" against a case known to be
good before reporting it**, or the instrument writes the diagnosis.

### Uploading is not distributing — measured 2026-11-04

The webhook works. A push to `main` with real `src/` changes started a build within seconds,
finished in about three minutes, and Apple had the IPA:

```
6aeabd7a…64d  finished  main  1a7bce84
build 1793768919  VALID  uploaded=2026-11-03T21:11:32-08:00
```

Docs-only commits were **skipped** by the changeset filter, correctly — three of them that
evening never built.

**And the build was not installable by anyone.** The `Internal` group still held only the two
31 October builds, because the group has `hasAccessToAllBuilds=false` and nothing in the pipeline
adds a build to it. The upload step's own comment already warns that a green step is not proof
Apple has the build; this is the next link in that chain, and it fails the same quiet way — the
pipeline is green, Apple has the IPA, `processingState` is `VALID`, and TestFlight shows the
tester the *old* version with no error anywhere.

(How the October builds got into the group is not known — nothing in `codemagic.yaml` does it, so
it was done by hand at some point. The useful fact is that it does not happen by itself.)

So after any build that someone is waiting on:

```python
# ask the GROUP, never /builds/{id}/betaGroups - that direction reports nothing
GET  /betaGroups/{gid}/builds
POST /betaGroups/{gid}/relationships/builds   {"data":[{"type":"builds","id":"<build id>"}]}
GET  /betaGroups/{gid}/builds                 # 204 means accepted, not done
```

`scripts`-adjacent helper used for this lives in the session scratchpad rather than the repo; the
three calls above are the whole of it.

**Automated the same night.** The publish step now carries `--beta-group "Internal"`, which is a
documented, repeatable option of `app-store-connect publish` rather than a script of ours:

```yaml
app-store-connect publish
  --path "build/ios/ipa/*.ipa"
  --beta-group "Internal"
  --max-find-build-wait 15
```

**Verified by the push that made the change.** Adding `codemagic.yaml` to the changeset filter
meant that commit built itself, and the build it produced arrived in the group with nobody
touching App Store Connect:

```
builds the Internal group can install: 4
   1793769714  VALID  uploaded=2026-11-03T21:24:36-08:00   <- arrived by itself
   1793768919  VALID  uploaded=2026-11-03T21:11:32-08:00   <- added by hand, before the fix
   1793484505  VALID  uploaded=2026-10-31T15:11:02-07:00
   1793473364  VALID  uploaded=2026-10-31T12:05:13-07:00
```

Two consequences worth knowing before the next build:

- **It is slower, and now measured rather than guessed: 204s before, 511s after.** Adding a
  build to a group means waiting for Apple to list it, which the bare upload never did.
  `--max-find-build-wait` bounds the wait instead of letting the workflow hang. Worth it: the
  step going green now means installable rather than merely uploaded.
- **`codemagic.yaml` is now in the changeset filter.** It was not, so a change to how builds are
  made, signed or distributed would never have been exercised — this fix would have sat unproven
  until some unrelated `src/` change happened along.

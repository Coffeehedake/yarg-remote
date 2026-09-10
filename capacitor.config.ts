import type { CapacitorConfig } from "@capacitor/cli";

// YARG Remote is a self-contained (bundled) app: the built web UI in dist/ is
// packaged into the native binary, so the UI opens even before it can reach a
// console. Only the data calls hit the YARG server, at an address the user sets
// in-app - the same shape ShopStack Mobile uses, and for the same reason: one
// build has to work against whatever machine is running the game tonight.
//
// CapacitorHttp routes fetch() through the NATIVE http stack rather than the web
// view. Two consequences worth knowing before debugging something strange:
//
//   1. No CORS. The game's server does not have to grant this app anything.
//   2. The request is labelled with the shell's own origin (capacitor://localhost
//      on iOS, http://localhost on Android) rather than an http address. The
//      server allows exactly those, deliberately - see IsNativeShellOrigin in
//      RemoteQueueServer.cs. That allowance is what makes this app work at all,
//      and it does not weaken the cross-origin check, because a real web page
//      cannot claim one of those origins.
//
// PLAIN HTTP IS THE POINT. A console on a home LAN has no certificate, so both
// platforms need their cleartext exceptions: NSAllowsLocalNetworking on iOS and
// a network-security-config on Android. Those are applied after `cap add`; see
// README.md, "Native setup".
const config: CapacitorConfig = {
  appId: "com.fatalexception.yargremote",
  appName: "YARG Remote",
  webDir: "dist",
  plugins: {
    CapacitorHttp: { enabled: true },
  },
  ios: { contentInset: "never" },
};

export default config;

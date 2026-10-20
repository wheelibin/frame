# PF1007L: upgrading System WebView from 44 to 106

Root cause of the ES5-only constraint documented in `dashboard/README.md`'s "WebView 44
trap" section. Followed the upstream repo's own procedure
(`wesbos/photo-frame-dashboard`, `docs/allwinner-a33-pf1007l.md` §6) against this exact
device, over the persistent root ADB already set up per `pf1007l-root-adb.md`.

Requires root ADB (already persistent on this unit) and `/system` writable via remount —
no additional access beyond what was already in place.

## Source, verified

```
WebView 106.0.5249.126 ARM
https://raw.githubusercontent.com/LineageOS/android_external_chromium-webview_prebuilt_arm/4b0ae494a7dd/webview.apk
SHA-256: e2edc1f89ec1608b169da9e7ffc037190b70c7825f0be29694f4cae719980580
```

Re-fetched the upstream doc fresh immediately before use rather than trusting any earlier
summary of it — two automated summarizations of the same source during planning gave
inconsistent hash transcriptions for this exact value (one had an extra trailing
character). The value above is confirmed three ways: matches the doc's own table verbatim
(fetched a third time, asked to reproduce without summarizing), matches the downloaded
APK's own `shasum -a 256`, and matches byte-for-byte (`cmp`) after every push/copy between
host and device. **Always re-fetch and re-verify this value directly before reusing this
procedure** — don't copy the hash from this file without checking it still matches the
live source, in case the upstream repo's own content changes.

Old version, for reference: `44.0.2403.119` (pulled and preserved, see below).

## What was actually done

1. Pulled `/system/app/webview/webview.apk` (the pre-upgrade 44.0.2403.119 build) to the
   host as a targeted backup before touching anything, verified its hash
   (`e8334af7dbff490dc016167f6182829fded15c7f5592afe170a140e4516c3cc3`).
2. Downloaded the verified WebView 106 APK, extracted `lib/armeabi-v7a/*.so`
   (`libchromium_android_linker.so`, `libcrashpad_handler_trampoline.so`,
   `libwebviewchromium.so`) locally.
3. Staged everything in `/data/local/tmp` first, verified byte-for-byte via
   `adb exec-out cat | shasum`/`cmp` against the host copies before it ever touched a
   system partition.
4. Remounted `/system` read-write, built `/system/homehq-new-webview/lib/arm/` with the
   apk + libs, `root:root` / dirs `0755` / files `0644`. Verified byte-for-byte again —
   nothing live touched yet at this point.
5. Atomic swap: `mv /system/app/webview /system/homehq-stock-webview` (whole tree,
   including its `oat/` dir — preserves the original odex, not just the apk), then
   `mv /system/homehq-new-webview /system/app/webview`. Verified byte-for-byte a third
   time against the now-live files, `sync`, remounted `/system` read-only.
6. Rebooted. Recovered in ~15s (not the "hangs for a few minutes" behavior noted
   elsewhere for this unit on ordinary reboots — this particular reboot was fast and
   clean).
7. Verified functionally, not just via `dumpsys` version string (the upstream doc
   explicitly warns a bare APK swap can report the new version while failing at runtime,
   since Android 6 doesn't extract compressed native libraries for system apps):
   - `dumpsys package com.android.webview` → `versionName=106.0.5249.126`.
   - Fresh-boot logcat showed `WebViewFactory: Loading com.android.webview version
106.0.5249.126`, the `RelroFileCreator` log explicitly naming
     `/system/app/webview/lib/arm/libwebviewchromium.so` as the 32-bit lib it loaded (the
     exact path staged above), and `cr_WebViewApkApp: Launched version=106.0.5249.126` for
     both the `webview_service` and `webview_apk` processes. No `dlopen failed`/"Failed to
     load library" for WebView anywhere in the log (the one hit for `libemoji.so` is an
     unrelated pre-existing system quirk).
   - `HomeHQ: WebView remote debugging off` in logcat confirms Home HQ's own WebView
     instance initialized successfully (this line only logs post-init).
   - Served a temporary probe page (not committed) exercising `async`/`await`, array
     destructuring, a template literal, a CSS custom property, and `backdrop-filter`, all
     in the same inline script, with output both before and after the modern-syntax block
     to confirm the whole script keeps running (not just "didn't throw"). All passed:
     async/await + destructuring + template literal evaluated correctly, the custom
     property's color applied and rendered, `backdrop-filter: blur(4px)` reported as
     applied via `getComputedStyle`, and both the before- and after-markers printed —
     i.e. a silent whole-script death (the actual WebView-44 failure mode) did not
     recur. Removed the probe page immediately after.
   - Reloaded the real dashboard: renders identically to pre-upgrade, no regressions.

## Known gotcha hit during this procedure

`find /path -exec chmod ... \;` **segfaults on this device's shell** (toybox-based,
limited). Setting permissions via `find -exec` silently crashed mid-command and left
files at their `cp`-inherited `rwxrwxrwx` mode. Worked around by calling `chmod` directly
on each known path instead of via `find`. If re-running this procedure, use direct
`chmod`/`chown` calls per file/dir, not `find -exec` — this is a shell/toybox limitation
on this specific device, not specific to the WebView files themselves.

## Rollback

The original tree is preserved, not deleted, at `/system/homehq-stock-webview` (whole
tree including `oat/`). To revert:

```sh
adb -d shell mount -o rw,remount /system
adb -d shell mv /system/app/webview /system/homehq-106-rolled-back
adb -d shell mv /system/homehq-stock-webview /system/app/webview
adb -d shell chown -R root:root /system/app/webview
adb -d shell sync
adb -d shell mount -o ro,remount /system
adb -d reboot
```

A host-side copy of the pre-upgrade `webview.apk` (hash above) also exists outside this
repo on the machine this was performed from, as a second reference copy.

## Known side effect

`dex2oat` failed to AOT-compile the new WebView apk post-swap
(`/data/dalvik-cache/arm/system@app@webview@webview.apk@classes.dex: Permission denied`),
so it's currently running interpreted rather than pre-compiled — a performance-only
effect (slower execution, not a correctness issue), not investigated further since
WebView loaded and the dashboard performs fine in practice. Worth revisiting if the
kiosk's WebView startup/responsiveness ever becomes a problem.

## Still true, unchanged by this upgrade

- `adb -d reboot` is still the one tool-level operation known to hang on this unit
  sometimes (this particular reboot didn't).
- No microSD card was available for this session — the U-Boot recovery route remained an
  accepted, undemonstrated risk throughout. It wasn't needed this time; that's not the
  same as it being unnecessary to have for next time.
- `backups/emmc-full.img` is unchanged by this operation and still reflects its prior
  state (post-root, post-lockdown, pre-this-upgrade) — not re-taken, since the targeted
  `webview.apk` pull above already covers what this operation actually touched.

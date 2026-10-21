# PF1007L: getting persistent root ADB and locking down the vendor channel

Record of how this specific PF1007L unit was rooted, what was tried and abandoned, and
the current security state. Written after the fact from the session log, for anyone
(including future-me) continuing work on this frame.

## Hardware

| Item                          | Value                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model                         | PF1007L (Allwinner A33)                                                                                                                                                                                                      |
| Firmware                      | `YHK.F-null-A33-1001-D1024-PF1007L-V10-1680.0.20260529`                                                                                                                                                                      |
| AiMOR version                 | 6.0.78                                                                                                                                                                                                                       |
| Android                       | 6.0.1, API 23, `armeabi-v7a`                                                                                                                                                                                                 |
| Ports                         | USB-C only, no DC jack, microSD/TF slot, recessed reset pinhole                                                                                                                                                              |
| eMMC                          | 30,777,344 sectors (15,758,000,128 bytes) — confirmed via `cat /sys/block/mmcblk0/size` post-root; this firmware ships with either this or the smaller 30,535,680-sector eMMC, and this unit turned out to be the larger one |
| Boot partition                | `mmcblk0p6`, start sector 172032, 65,536 sectors                                                                                                                                                                             |
| Boot image SHA-256 (original) | `6c118dc1aa583797884c33cd3ac3796c72b2bd3a3f1fcafd1bf0982ae5f29e2c`                                                                                                                                                           |
| Boot image SHA-256 (patched)  | `8c05b34e4b4b2bd09ea2d6f86b29e0a5b62bfd18d69b1648269a7eee55c7c84b`                                                                                                                                                           |

Both hashes match the published firmware table for this exact build in
[wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard), which was
the primary reference for everything below.

## Prerequisites that tripped us up early

- **Power**: the single USB-C port is also the only power input. Insufficient power caused
  the frame to shut down mid-boot. A powered USB hub (or a wall charger with a USB-A port)
  fixed this.
- **Cable**: USB-C to USB-C gave no power and no data on this unit — the frame appears to
  lack the CC pull-down resistors a C-to-C host needs. A USB-A to USB-C data cable, through
  a USB-A port (direct or via a powered hub), is required.
- **Wi-Fi password loop**: the frame repeatedly rejected the correct Wi-Fi password.
  Two separate causes, both worth checking if this recurs:
  1. Wrong system clock (this board has no battery-backed RTC, so it resets after a power
     loss) — fixed by correcting the date/time on-device.
  2. The FRITZ!Box's default WPA2/WPA3 mixed mode with PMF (802.11w) likely isn't supported
     by this frame's AIC8800 Wi-Fi chip. Disabling 5GHz / forcing a simpler security mode on
     the router resolved it.
- **IP/MAC churn**: the AIC8800 Wi-Fi chip has no stored MAC address, so it burns a new
  random MAC — and therefore a new DHCP IP — on **every** Wi-Fi reconnect, not just every
  boot. The frame's FRITZ!Box **hostname** (`android-<hex-id>`, a fixed per-device string —
  check your own router's device list) stays
  stable across these changes, so it's the reliable way to re-identify the device if its IP
  moves.

## Route tried and abandoned: T3c (vendor-channel DNS redirect)

The project documents a technique where AiMOR's own "phone home" connection to its vendor
server (`imsconnect.efercro.com`, TCP 7806) is intercepted locally: redirect that one
hostname's DNS to your own machine, pose as the vendor server, and send AiMOR the one
runtime command it already trusts (`setprop service.adb.tcp.port 5555; stop adbd; start
adbd`), which turns on ADB over Wi-Fi with no flashing involved.

This is documented as working on this exact firmware build in the upstream repo (issue
#117), so it was the first thing attempted. It did not work for this unit after extensive
effort:

- Built a local DNS responder (`scripts/aimor-network-adb/dns.py`) and command listener
  (`scripts/aimor-network-adb/server.py`) from the repo, pointed at the frame.
- Repeatedly lost the race against the frame's IP/MAC churn — every time helpers were
  re-pointed at a newly observed IP, the frame had often already moved to a different one.
- Widened the DNS responder to answer for the entire subnet and made the command listener
  self-correct on any rejected connection attempt, removing the IP-matching race entirely.
- Even with that fixed, **zero** DNS queries or connection attempts for the vendor hostname
  were ever observed from the frame — across multiple Wi-Fi toggles and one full power-cycle
  reboot, each given a clean multi-minute window.

Working theory: AiMOR likely resolves and connects to its vendor server once, early, and
then just keeps that connection alive with lightweight heartbeats rather than re-resolving
DNS on reconnect. Forcing a fresh resolution attempt would need the existing connection to
actually drop first, and there's no way to force that from outside without touching Wi-Fi
(which rotates the MAC) or the app process itself (no Settings → Apps access on this
AiMOR-skinned build to force-stop just the vendor app).

This path is not recommended as a first attempt on this firmware/unit combination — the
recovery-window route below was far more reliable in practice.

## Route used successfully: boot patch via stock recovery's root-ADB window

The project's firmware table lists, for this exact build, a route called "recovery-window
write" — also directly reachable via **a "Recovery Mode" button visible on the AiMOR boot
screen itself**, with no need to hold the physical reset pin.

Selecting **Factory reset** from that Recovery Mode screen opens a short (~13-20 second)
root-ADB window (`18d1:d001`, confirmed via `adb -d get-state` returning `recovery`) before
the reset completes. This is the same stock Android recovery that ships on the device; the
window is a security gap in it, not something we added. All work in this window is read-only
(file pulls) except for the two short writes in the final step.

### Steps actually run (from the repo root of a local clone)

1. **Pull boot partition, get its T6 hash** — run before triggering the reset, waits for the
   window:

   ```sh
   scripts/a33-uboot/recovery-pull.sh 600
   ```

   On the frame: tap **Recovery Mode → Factory reset**. The script auto-pulls `boot`, `env`,
   `misc`, `bootloader`, `recovery` and prints boot's SHA-256. **This erases the frame's user
   data** — at this point in a fresh unit that's expected and fine.
   Result: hash matched the firmware table exactly (`6c118dc1...`), confirming this unit's
   boot image is byte-identical to the one the published patch was built against.

2. **Build the patch locally** (no device involved):

   ```sh
   python3 -I scripts/a33-uboot/recovery-patch-build.py diagnostics/recovery-pull/try1/boot.img \
     6c118dc1aa583797884c33cd3ac3796c72b2bd3a3f1fcafd1bf0982ae5f29e2c
   ```

   Confirmed: one cpio entry changed (`init.sun8i.usb.rc`), header changes limited to ramdisk
   size + image ID, patched hash `8c05b34e...` — matching the upstream report byte-for-byte.

3. **Read-only check in another reset window** — confirms the exact write target before any
   byte is touched:

   ```sh
   scripts/a33-uboot/recovery-patch.sh check 600
   ```

   Tap **Recovery Mode → Factory reset** again. Result: boot node identified as
   `/dev/block/mmcblk0p6` (start 172032, size 65536, as expected), current contents
   confirmed as the original image. Nothing written.

4. **The actual write**, with explicit owner approval beforehand, in a third reset window:

   ```sh
   scripts/a33-uboot/recovery-patch.sh write 600
   ```

   Two pushes (patched ramdisk + kernel, then the 1024-byte patched header), then an
   automatic read-back. Result: `VERIFY OK: the boot partition holds the patched image`.

5. **Confirm after reboot**:
   ```sh
   adb devices -l                         # 1f3a:1002, state "device"
   adb -d shell id                        # uid=0(root)
   adb -d shell getprop ro.build.fingerprint
   adb -d shell getprop sys.boot_completed # 1
   ```
   All passed. Root ADB over USB is now **persistent** — it's a disk patch to the boot
   ramdisk (the USB mass-storage init action now also enables `adb`, product ID `1002`,
   starts `adbd`), not a runtime trick, so it survives reboots and power cuts.

### What the patch actually changes

Only `init.sun8i.usb.rc` in the ramdisk, and only its `mass_storage` USB action:

```diff
 on property:sys.usb.config=mass_storage
     write /sys/class/android_usb/android0/enable 0
     write /sys/class/android_usb/android0/idVendor 1f3a
-    write /sys/class/android_usb/android0/idProduct 1000
-    write /sys/class/android_usb/android0/functions mass_storage
+    write /sys/class/android_usb/android0/idProduct 1002
+    write /sys/class/android_usb/android0/functions mass_storage,adb
     write /sys/class/android_usb/android0/enable 1
+    start adbd
     setprop sys.usb.state ${sys.usb.config}
```

Kernel and every other ramdisk file are byte-identical to stock.

### Undo, if ever needed

With root ADB already working, the original image can be restored directly from the running
system — no recovery window required:

```sh
adb -d shell 'dd if=/data/local/tmp/boot-orig.img of=/dev/block/mmcblk0p6 bs=1048576 && sync'
```

(push the saved original boot image to `/data/local/tmp/boot-orig.img` first, and verify its
hash before and after, per the upstream doc's undo section). If the frame fails to boot
_before_ a backup/undo is possible, the only documented repair path needs a microSD card
(Route U/S) — none was available for this session, which is why the recovery-window route
(no SD card needed) was used in the first place.

## Locking down the vendor channel

AiMOR's vendor server can push arbitrary root shell commands to the frame over an
unencrypted channel (the same mechanism the abandoned T3c route exploited, but for a
real vendor command, not ours). This is a standing exposure for as long as the frame is
powered, on Wi-Fi, and running AiMOR — not an actively-exploited emergency, but worth
closing.

**Decision**: block it via DNS rather than with an in-memory `iptables` rule on the frame
(which clears on every reboot) or a from-scratch custom `init.rc` edit (more complex,
untested by the upstream project, and risks breaking the `adb`-enabling trigger we just
got working, for a benefit — surviving the frame leaving this network — that isn't needed
here).

**First attempt (FRITZ!Box 7530 parental-control blocklist) — did not actually work:**

Added both hostnames to a FRITZ!Box "Blocked websites" list and attached it to the
**Standard** access profile (rather than a profile scoped to the frame's own device entry,
since its MAC changes on every Wi-Fi reconnect, making per-device targeting unreliable).
This _appeared_ to work once, briefly, after toggling the frame's Wi-Fi off/on — but was
flaky and regressed on a later plain reboot with no config changes. Root cause: **this
network's actual DNS server is a local Pi-hole, not FRITZ!Box's own resolver.** FRITZ!Box's
website-blocking filters queries it resolves itself; since clients (including the frame)
use the Pi-hole directly, FRITZ!Box's rule was mostly not in the resolution path at all.
Whatever blocking was observed earlier was likely incidental (DNS-settings transition
timing or caching), not the rule actually functioning. Left in place on FRITZ!Box since
it's harmless, but it is not the thing actually doing the blocking.

**What actually works: Pi-hole blacklist.**

1. Pi-hole admin UI → Group Management → Domains → **Blacklist**, **Exact** match, add
   both `imsconnect.efercro.com` and `iwsconnect.efercro.com`.
2. No restart needed — Pi-hole blacklist changes apply immediately, to every query it
   resolves, with no per-device profile or MAC-matching involved.

**Verified result** (from the frame itself, `adb -d shell ping -c 1 -W 3 <host>`), after
adding the Pi-hole blacklist entries:

| Host                     | Result                                                       |
| ------------------------ | ------------------------------------------------------------ |
| `imsconnect.efercro.com` | `unknown host` — blocked                                     |
| `iwsconnect.efercro.com` | `unknown host` — blocked                                     |
| `8.8.8.8`                | resolves and responds normally — general internet unaffected |

## Full backup

A full raw read of the eMMC, taken over USB now that root ADB is persistent (no recovery
window needed):

```sh
adb -d exec-out 'dd if=/dev/block/mmcblk0 bs=1048576 2>/dev/null' > backups/emmc-full.img
shasum -a 256 backups/emmc-full.img > backups/emmc-full.img.sha256
```

|             | Value                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size        | 15,758,000,128 bytes — exact match to the eMMC's reported size                                                                                    |
| SHA-256     | `150a54ccf8fc3cca9ca726070ab093dc7064a2d71ec3b3092f0a6faf62609077`                                                                                |
| Cross-check | boot-partition region of this backup, a fresh independent read straight from the device, and the previously-recorded patched-image hash all agree |

Stored at `backups/emmc-full.img` (gitignored — kept private per the upstream project's own
rules, never commit this). This captures the **current** state: boot already patched,
userdata already wiped by the earlier factory resets. It is not a path back to pristine
factory state — see the note on this above. It's a safety net against anything going wrong
_from here on_.

## Current state / what's not done yet

- [x] Persistent root ADB over USB
- [x] Vendor command channel blocked (via Pi-hole DNS blacklist — the FRITZ!Box rule alone
      was not effective; see above)
- [x] `com.yhk.qeota` (firmware updater) and `com.DeviceTest` (factory test app) — disabled
      via `adb shell pm disable <package>`, confirmed persisted to
      `/data/system/users/0/package-restrictions.xml` (`enabled="2"` for both)
- [x] Full eMMC backup taken and verified (see above)
- [x] Replacement launcher (Home HQ, `com.wesbos.homehq`) installed, built from the repo's
      `dashboard/kiosk/build.sh` (no Gradle — aapt2 + javac + d8 + zipalign + apksigner,
      JDK 17 + Android build-tools 34/platform 34 via `android-commandlinetools`), set as
      the persistent Home app, **confirmed surviving an actual reboot**, with the two-finger
      fallback menu (Settings / Wi-Fi / Open launcher / Reload) confirmed working on the
      physical screen.
- [x] Home HQ's floating navigation accessibility service enabled — **this is the actual
      escape hatch, not the two-finger gesture.** This firmware has no system nav bar, and
      the two-finger menu only works _inside_ Home HQ: it cannot get you back once you're in
      Settings or any other app. Learned this by getting stuck in Settings after changing
      the timezone, with no physical way out. Fixed with:
      `sh
  adb -d shell settings put secure enabled_accessibility_services com.wesbos.homehq/.NavigationService
  adb -d shell settings put secure accessibility_enabled 1
  adb -d shell pm grant com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS
  `
      The last line matters on its own: per the kiosk README, this firmware drops the
      service from the enabled list after every `adb install -r` or force-stop of Home HQ;
      the grant lets Home HQ silently re-enable itself each time it starts. Gives small
      floating **Back**/**Dashboard** buttons outside Home HQ, draggable, position
      remembered. If stuck without this already on and without a computer handy: there's no
      physical fallback — this is worth doing before the frame goes anywhere unattended.
- [ ] `com.efercro.os.aimor` — **still intentionally enabled**, kept as the "Open launcher"
      fallback target. Disable only once whatever Home HQ ends up showing is something you'd
      actually want running full-time. Some builds hide disabled apps in Settings, and this
      is a documented way people have locked themselves out of this exact device.

### Setting Home HQ as the persistent Home app

```sh
adb -d install -r dashboard/kiosk/build/homehq.apk
adb -d shell am start -n com.wesbos.homehq/.MainActivity --ez home true
adb -d shell am start -a android.intent.action.MAIN -c android.intent.category.HOME
# Android 6 has no `cmd package set-home-activity` — tap Home HQ, then Always, on the frame.
```

Verify it persisted (should show `always="true"` with both Home HQ and AiMOR in the `set`):

```sh
adb -d shell 'cat /data/system/users/0/package-restrictions.xml'
```

`adb -d reboot` **hung this unit** on the actual reboot command (matches the upstream note:
"`adb reboot` hangs on many units"). It did eventually come back on its own through the
normal AiMOR boot animation — just don't assume a stuck screen means bricked; give it a
minute before resorting to a manual power cycle.

### Live-reloading content during development

The kiosk's URL is a runtime-saved preference, not a rebuild-and-reinstall cycle:

```sh
adb -d reverse tcp:8765 tcp:8765   # must be redone after every reboot/USB reconnect
adb -d shell am start -n com.wesbos.homehq/.MainActivity --es url http://localhost:8765/
```

`scripts/set-kiosk-url.sh <url>` (repo root) does the same and also prints the currently
saved URL when run with none.

## Useful commands going forward

```sh
adb devices -l                 # confirm USB connection; expect 1f3a:1002, state "device"
adb -d shell id                # confirm root
adb -d shell 'netstat -an | grep :7806'   # confirm no active vendor-channel connection
```

## Reference

Primary source for all routes and scripts:
[wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard), specifically:

- `docs/pf1007l-start-here.md` — overall test sequence and firmware table
- `docs/pf1007l-macos-20260529-recovery-boot-write.md` — the exact route used here
- `docs/aimor-remote-root-shell.md` — the vendor remote-root-shell behavior and lockdown steps
- `docs/pf1007l-20260410-network-adb.md` — the T3c route (not successful for this unit)
- `scripts/a33-uboot/` — `recovery-pull.sh`, `recovery-patch-build.py`, `recovery-patch.sh`
- `scripts/aimor-network-adb/` — `dns.py`, `server.py` (T3c tooling)

# Useful ADB commands for this frame

Reference list, grouped by purpose. See [pf1007l-root-adb.md](pf1007l-root-adb.md) for how
root ADB was obtained and what's been changed on the device.

## Wi-Fi vs USB — the actual state right now

**Everything below currently requires USB** (`adb -d`, meaning "the one USB-connected
device"). Wi-Fi ADB is **not set up yet** — doing it the easy way
(`adb tcpip 5555` / `persist.service.adb.tcp.port`) would open unauthenticated root ADB to
the whole LAN permanently, the same class of problem this whole project just spent effort
closing for AiMOR's vendor channel. The documented right way is a **key-authenticated**
boot-ramdisk patch (your public key in `/adb_keys`, `ro.adb.secure=1`) — not done yet, it's
a separate task.

Once that exists, **almost every command below works identically over Wi-Fi** — the ADB
protocol itself (`shell`, `install`, `pm`, `am`, `reverse`, `forward`) doesn't care whether
the transport is USB or TCP/IP. The only thing that changes is the target flag:

```sh
adb -d ...                      # the one USB-connected device (current, works today)
adb connect <frame-ip>:5555     # once key-auth Wi-Fi ADB exists
adb -s <frame-ip>:5555 ...      # target it specifically (needed if more than one device)
```

**Finding the frame's IP**: its Wi-Fi chip burns a new random MAC (and therefore a new DHCP
IP) on every reconnect, not just every boot. The one stable identifier across that churn is
its FRITZ!Box hostname — check for `android-<hex-id>.fritz.box` in the router's device
list (the hex-id is fixed per device), or `arp -a | grep <first-4-bytes-of-MAC>` from the
Mac (the first 4 bytes of the MAC stay constant across reconnects on this chip, only the
last two octets rotate — check your own unit's prefix once via the router's device list).

## Connection / identity

```sh
adb devices -l                            # confirm USB connection; expect 1f3a:1002, state "device"
adb -d shell id                           # confirm root (uid=0)
adb -d shell getprop ro.build.fingerprint
adb -d shell getprop sys.boot_completed   # 1 once fully booted
```

## Kiosk / dashboard control (Home HQ, com.wesbos.homehq)

```sh
# Point the kiosk at a URL (persists across reboots, saved as a preference)
adb -d shell am start -n com.wesbos.homehq/.MainActivity --es url https://your-dashboard/
# or: scripts/set-kiosk-url.sh <url>   (from the repo root; prints current URL if called with none)

# Dev-mode local serving: forward a port on the frame back to this Mac over USB
adb -d reverse tcp:8765 tcp:8765        # must redo after every reboot/USB reconnect
# then point the kiosk at http://localhost:8765/

# Escape to the kiosk from anywhere (no on-screen nav bar on this firmware)
adb -d shell input keyevent KEYCODE_HOME

# Re-trigger the Home app chooser (needed if ever reinstalling with a clean slate)
adb -d shell am start -a android.intent.action.MAIN -c android.intent.category.HOME
# then tap Home HQ -> Always on the frame itself
```

## App management

```sh
adb -d install -r dashboard/kiosk/build/homehq.apk   # (re)install the kiosk
adb -d shell pm list packages -d                     # list currently disabled packages
adb -d shell pm disable <package>                    # persists to package-restrictions.xml
adb -d shell pm enable <package>                      # undo
```

## Security checks

```sh
adb -d shell 'netstat -an | grep :7806'    # should be empty: no active connection to AiMOR's vendor channel
adb -d shell 'cat /data/system/users/0/package-restrictions.xml'   # confirm disabled apps + Home choice persisted
```

## Backup

```sh
# Full raw eMMC (~15.76 GB, ~20-30 min over USB)
adb -d exec-out 'dd if=/dev/block/mmcblk0 bs=1048576 2>/dev/null' > backups/emmc-full.img
shasum -a 256 backups/emmc-full.img

# Just the boot partition, with its T6-style hash (sector 172032, 31,028 sectors)
adb -d exec-out 'dd if=/dev/block/mmcblk0p6 bs=512 count=31028 2>/dev/null' | shasum -a 256
```

## Gotchas

- **`adb -d reboot` hung this unit** on the actual reboot. It came back on its own through
  the normal AiMOR boot animation after a bit — don't assume a stuck/dark screen means
  bricked; give it a minute before resorting to a manual power cycle.
- **`adb -d shell input keyevent KEYCODE_HOME`** is the fastest way back to the kiosk if
  stuck somewhere with ADB handy. Without ADB, see the floating Back/Dashboard buttons note
  in [pf1007l-root-adb.md](pf1007l-root-adb.md) — the two-finger gesture only works *inside*
  Home HQ, not from Settings or any other app.

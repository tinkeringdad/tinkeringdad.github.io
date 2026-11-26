# Plain TV

A plain home screen for Google TV (built for a TCL Google TV): a search bar, Inputs,
TV settings and your apps. No recommendations, and no Gemini.

- **Home screen**: your apps in a grid. Hold the select button on an app to move or hide it.
- **Plain search**: type, or press *Speak* for voice typing (speech-to-text only, not an
  assistant). Results: matching apps, "Search YouTube for …", "Search <app> for …" for
  any installed app that accepts searches, and the web if a browser is installed.
  Nothing goes to Gemini or Google's assistant.
- **Inputs**: lists the TV's HDMI inputs and opens them.
- **Remote-button helper** (optional accessibility service):
  - Home button → Plain TV instead of the Google TV home screen.
  - Assistant/mic button → Plain search instead of Gemini.

## Install

Pick one way to get the APK onto the TV:

- **ADB (best, also turns the helper on for you)**
  1. On the TV: Settings → System → About → click *Android TV OS build* 7 times to turn on
     developer options. Then Settings → System → Developer options → turn on *USB debugging*
     (on some models it's called *Network debugging* or *Wireless debugging*). Note the TV's IP address
     (Settings → Network & Internet).
  2. On a computer with platform-tools:
     ```
     adb connect <TV-IP>          # accept the prompt on the TV
     adb install PlainTV-v0.1.0.apk
     adb shell settings put secure enabled_accessibility_services com.tinkeringdad.plaintv/.RemoteButtonService
     adb shell settings put secure accessibility_enabled 1
     ```
     Note: the `enabled_accessibility_services` line replaces any other accessibility
     services you have turned on. If you use others, turn Plain TV on in TV settings instead.
- **Downloader app**: install *Downloader* from the Play Store, allow it to install
  unknown apps when asked, and enter the APK's URL.

## Turn on the helper (if you didn't use the ADB commands)

TV Settings → System → Accessibility → **Plain TV remote buttons** → On.
Or open Plain TV → *Plain TV* button (top bar) → *Open accessibility settings*.

If the switch is greyed out ("restricted setting"), that's Android blocking sideloaded
apps from accessibility. Use the ADB commands above.

## Good to know

- Google TV won't let you choose a different home app. The helper works around that by
  noticing the Google TV home screen open and bringing Plain TV to the front, so you may
  see Google TV flash for a moment.
- The Assistant button: on the Google TV emulator this key goes straight to the assistant,
  so the helper closes the assistant's overlay as soon as it opens and starts Plain search's
  voice typing instead. Remotes vary. Plain TV → *What the helper has seen recently* shows
  the button codes and apps it saw, which helps if your remote behaves differently.
- Google's "who's watching" profile picker is left alone.

## Stronger option: switch off the Google TV home screen (ADB, reversible)

```
adb shell pm disable-user --user 0 com.google.android.apps.tv.launcherx
```
Then Plain TV is the real home app and there's no flash. Some Google TV features (the
profile switcher, the Google TV "For you" tabs, some setup screens) stop working while
it's off. To undo:
```
adb shell pm enable com.google.android.apps.tv.launcherx
```

## Build

Needs the Android SDK (platform 35, build-tools 35).
```
echo "sdk.dir=/path/to/android-sdk" > local.properties
gradle assembleRelease
```
Signing reads `keystore.properties` (not committed) if present.

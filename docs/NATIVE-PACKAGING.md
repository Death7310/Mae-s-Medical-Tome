# Native packaging (optional)

The app is a Progressive Web App. On all three target platforms the browser install is the simplest, most reliable path and needs no store account:

- **Windows**: Edge or Chrome → install icon in the address bar. Edge-installed PWAs appear in Start, the taskbar and Settings → Apps like any program.
- **Android**: Chrome → ⋮ → *Install app*. Samsung Internet and Firefox also support it.
- **Huawei / HarmonyOS**: Huawei Browser → menu → *Add to* → *Home screen*. Huawei Browser is Chromium-based; service workers, IndexedDB and the camera API used for QR scanning all work. Google Play Services are not involved anywhere in this app.

Wrap it only if you need a store listing or an icon that arrives as a file.

## Android / Huawei APK (built for you by CI)

The repository contains a ready Capacitor Android project under `android/`. Every push to the deploy branches runs `.github/workflows/android.yml`, which builds a signed release APK and publishes it at a fixed address:

```
https://github.com/Death7310/Mae-s-Medical-Tome/releases/latest/download/maes-medical-tome.apk
```

Open that link on the phone, allow installation from the browser when Android asks, and install. The APK bundles the web app, so it is fully offline from first launch; the book and slides you load are stored on the phone. On the phone, "Download" buttons become "Save / share", which opens the Android share sheet.

**Signing.** By default CI signs with the development keystore committed at `android/keystore/dev-release.jks` (password `medicaltome`, alias `tome`). That is enough for personal sideloading, and updates install over each other because the key is constant. Because this repository is public, anyone can sign an APK with that same key, so before distributing the app to other people or submitting it to a store, switch to a private key: generate one with `keytool`, then add four repository secrets, `ANDROID_KEYSTORE_BASE64` (the .jks file base64-encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. The workflow uses them automatically. Note that phones with the dev-signed build must uninstall it before installing a build signed with the new key.

**Building locally** (needs Android Studio or the Android SDK plus JDK 21):

```bash
npm run build            # with VITE_BASE=/ (the default)
npx cap sync android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

The resulting APK:

- installs on any Android phone, and on Huawei phones without Google services (the app uses no Google APIs);
- can be submitted to Huawei AppGallery (sign up at developer.huawei.com, upload the APK/AAB) or Google Play;
- loads the web app from local files, so it is fully offline from the first launch.

Because the Capacitor app uses the system WebView, keep the WebView updated on test devices; very old WebViews (< Chromium 80) lack features such as `CompressionStream` fallbacks, which this app avoids, but PDF rendering performance improves markedly on recent ones.

## Windows executable

A plain PWA install is what Microsoft itself recommends and is what Store-listed PWAs use. If you want a signed `.exe`/`.msix`:

- **PWABuilder** (pwabuilder.com): paste the deployed URL, download the Windows package, optionally submit to the Microsoft Store.
- **Tauri** (small binary, uses Edge WebView2): `npm create tauri-app`, point `frontendDist` to `dist/`, `npm run tauri build`.

## Sync in a wrapped app

Nothing changes: the sync code is plain text. In a Capacitor app the Share button uses the native share sheet, and the camera is available to the QR scanner once the `CAMERA` permission is in `AndroidManifest.xml` (Capacitor adds it when `@capacitor/camera` is installed, or add `<uses-permission android:name="android.permission.CAMERA" />` manually).

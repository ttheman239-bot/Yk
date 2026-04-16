# Breathing Companion

A minimalist, single-file web app for guided breathing exercises.

Open `index.html` in a browser. No build, no dependencies.

## Patterns

- **Box 4-4-4-4** — equal inhale, hold, exhale, hold for calm focus
- **4-7-8** — longer exhale for deep relaxation
- **Coherent 5-5** — balanced rhythm to steady the heart

Press **Space** or click the play button to start. The orb expands and contracts with your breath; a countdown shows the seconds for each phase; cycle and session time are tracked.

## Android APK

A native Android wrapper lives in `android/`. Every push to `main` or a `claude/**` branch triggers the `Build Android APK` GitHub Actions workflow, which produces a debug APK as a downloadable artifact named `breathing-companion-debug` and republishes it to the rolling `snapshot` GitHub Release.

**Direct APK download:** https://github.com/ttheman239-bot/Yk/releases/download/snapshot/breathing-companion.apk

Local build (requires Android SDK + JDK 17):

```
cp index.html android/app/src/main/assets/index.html
cd android
./gradlew :app:assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

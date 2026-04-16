# Market Clock & Arbitrage

Single-file web app for tracking stock-market sessions across timezones and watching dual-listed stocks for arbitrage gaps.

## Features

- **Market clock** — live status (open / lunch / closed), countdown to next open or close, and local time for 20 major exchanges: NYSE, NASDAQ, TSX, B3, LSE, Euronext, Xetra, SIX, MOEX, JSE, NSE India, SET, SGX, HKEX, SSE, TWSE, KRX, TSE Tokyo, ASX, NZX. Lunch breaks are handled where they exist.
- **Dual-listed arbitrage** — pre-seeded pairs (BABA/9988, TSM/2330, TM/7203, BHP US/AU, RIO US/UK) plus a form to add your own. Prices auto-refresh every minute from Stooq. A FX leg converts the legs to a common currency; the spread column shows `((B × FX) / A − 1) × 100%`.
- **Portrait Android app** wrapping the same HTML in a WebView, built to APK via GitHub Actions.

## Use

Open `index.html` in any browser. No build, no dependencies.

Symbols use Stooq format: `aapl.us`, `9988.hk`, `7203.jp`, `ptt.th`, `bhp.au`, `2330.tw`, `hsbc.uk`. FX symbols look like `usdhkd`, `usdjpy`. Leave FX blank when both legs share a currency.

## Android APK

Every push to `main` or a `claude/**` branch triggers the `Build Android APK` workflow, which publishes the APK to a rolling `snapshot` GitHub Release.

**Direct download:** https://github.com/ttheman239-bot/Yk/releases/download/snapshot/market-clock.apk

Local build (requires Android SDK + JDK 17):

```
cp index.html android/app/src/main/assets/index.html
cd android
./gradlew :app:assembleDebug
```

# Lead-Lag Signal Analyzer

วิเคราะห์ความสัมพันธ์แบบ lead-lag ระหว่างตลาดหุ้นทั่วโลก (timezone arbitrage) — กดทำนายได้ว่าถ้า S&P 500 ขึ้น X% วันนี้ ตลาดเอเชียวันถัดไปจะตอบสนองอย่างไร พร้อม backtest ทางสถิติ

## ฟีเจอร์

- **Pair Analysis** — เลือก leader (S&P, NDX, VIX, oil, gold, BTC, DAX, FTSE) + follower (SET, Nikkei, HSI, KOSPI, STI, TWSE, SSE, ASX, Nifty) → ได้:
  - Current signal (เทรดตามสัญญาณวันนี้คาดว่าได้เท่าไร)
  - Correlation, β, R², t-stat (นัยสำคัญทางสถิติ)
  - Hit rate + conditional returns (leader up → follower avg, leader down → follower avg)
  - Backtest Sharpe, equity curve, final P&L
  - Scatter plot + regression line
- **Screener** — เลือก leader แล้วดู follower ทุกตัวเรียงตาม Sharpe

## สถาปัตยกรรมข้อมูล

`.github/workflows/fetch-data.yml` run cron วันละ 2 ครั้ง (หลัง US close + หลัง Asia close) ดึงข้อมูลจาก Stooq ด้วย `scripts/fetch-data.js` เขียน `data/<symbol>.json` แล้ว commit กลับเข้า repo แอพอ่านจาก `raw.githubusercontent.com` ดังนั้นใช้งานได้ทั้งบนเว็บและใน Android WebView (CORS OK)

## Android APK

Push ใด ๆ ไป `main` หรือ `claude/**` → `.github/workflows/build-apk.yml` build APK แล้ว publish ไป `snapshot` release

**ดาวน์โหลดตรง:** https://github.com/ttheman239-bot/Yk/releases/download/snapshot/lead-lag.apk

## Local

```
open index.html
```

หรือ build APK เอง (ต้องมี Android SDK + JDK 17):

```
cp index.html app.js android/app/src/main/assets/
cd android && ./gradlew :app:assembleDebug
```

# Crypto Signal Bot

Serverless crypto futures trading signal bot that generates **LONG/SHORT** signals using **multi-timeframe technical analysis + AI validation**, then delivers them directly to **Telegram**.

Deployed on **Vercel**, running every 15 minutes via cron jobs.

---

## Features

- **Multi-Timeframe Analysis (MTF)** — Analyzes 4H (Trend), 1H (Momentum), and 15M (Entry) simultaneously
- **Technical Indicators** — EMA(9/21) crossover, RSI(14), ATR(14), ADX(14), Volume SMA, Candlestick Patterns
- **BTC Trend Correlation** — Altcoin signals blocked if they conflict with BTC trend
- **AI Validation** — Google Gemini validates each signal against real-time market conditions
- **Paper Trading Tracker** — Tracks open trades in Supabase, monitors TP/SL hits automatically
- **Telegram Delivery** — Beautiful formatted signal messages with entry, SL, TP levels
- **Duplicate Prevention** — Cooldown window prevents the same signal from being sent repeatedly
- **Resilient** — Automatic retry on API failures, configurable AI fallback strategy

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Vercel Serverless                           │
│                                                                 │
│  ┌─────────────────────────────┐    ┌─────────────────────────┐ │
│  │  /api/cron/analyze          │    │  /api/webhook/telegram   │ │
│  │  (Runs every 15 min)        │    │  (Telegram commands)     │ │
│  └──────────┬──────────────────┘    └──────────┬──────────────┘ │
│             │                                   │                │
│    ┌────────▼────────┐                 ┌────────▼────────┐       │
│    │  MTF Analysis   │                 │  /status        │       │
│    │  AI Validation  │                 │  /analyze       │       │
│    │  Signal Output  │                 │  /watchlist     │       │
│    └────────┬────────┘                 │  /price         │       │
│             │                          │  /pnl           │       │
└─────────────┼──────────────────────────┴────────┬────────┘       │
              │                                   │                │
              ▼                                   ▼                │
┌─────────────────────────┐         ┌─────────────────────────────┐│
│  Binance Futures API    │         │  Supabase (PostgreSQL)      ││
│  (OHLCV + Price)        │         │  (Paper Trading DB)          ││
└─────────────────────────┘         └─────────────────────────────┘│
              │                                   ▲                │
              └────────── Google Gemini ──────────┘                │
                         (AI Researcher)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │   Telegram Bot   │
                     │   (Your Phone)   │
                     └──────────────────┘
```

---

## Signal Generation Flow

```
Cron Trigger (every 15m)
  │
  ├── Evaluate open trades (tracker)
  │     └─ Skip symbol if active trade exists
  │
  ├── Multi-Timeframe Analysis
  │     ├─ Fetch candles: 4H, 1H, 15M (parallel)
  │     ├─ Calculate indicators per timeframe
  │     └─ Count agreement (min 2/3 must agree)
  │
  ├── Filters
  │     ├─ BTC Trend Correlation (altcoins only)
  │     ├─ Volume Confirmation (15M must spike)
  │     └─ Market Regime (ADX ≥ 25 on 4H or 1H)
  │
  ├── AI Validation (Gemini)
  │     ├─ Retry up to 3x on 5xx errors
  │     └─ Fallback strategy if unavailable
  │
  ├── Duplicate Check (cooldown window)
  │
  └── Signal Sent → Telegram + Saved to DB
```

---

## Technical Indicators

| Indicator | Settings | Purpose |
|-----------|----------|---------|
| EMA Fast/Slow | 9 / 21 | Trend direction via crossover |
| RSI | 14 | Overbought (>70) / Oversold (<30) |
| ATR | 14 | Dynamic SL/TP levels |
| ADX | 14 | Trend strength (≥25 = trending) |
| Volume SMA | 20 | Volume spike detection (≥1.5×) |
| Candlestick Patterns | — | Bullish/Bearish Engulfing, Morning/Evening Star, Piercing Line, Dark Cloud Cover |

### SL/TP Calculation

| Level | Formula |
|-------|---------|
| Stop Loss | Entry ± (1.5 × ATR) |
| Take Profit | Entry ± (3.0 × ATR) |
| Risk/Reward (to TP vs SL) | (3.0 / 1.5) = **2.0** |
| Min Risk/Reward (enforced) | `MIN_RISK_REWARD` (default 2.0) — sinyal di-skip jika di bawah ini |

### Trade Management

- **Take Profit** → Posisi ditutup penuh di target
- **Stop Loss** → Posisi ditutup penuh di SL
- **Round-trip fee**: 0.2% factored into PnL

---

## Quick Start

### Prerequisites

- Node.js 20+
- Vercel CLI (`npm i -g vercel`)
- Supabase project (free tier OK)
- Telegram Bot Token ([BotFather](https://t.me/BotFather))
- Google Gemini API key ([aistudio.google.com](https://aistudio.google.com))

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID | [@userinfobot](https://t.me/userinfobot) |
| `GEMINI_API_KEY` | Google Gemini API key | [AI Studio](https://aistudio.google.com/apikey) |
| `CRON_SECRET` | Random string to protect cron endpoint | Generate yourself |
| `SUPABASE_URL` | Supabase project URL | Supabase Dashboard |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Supabase Dashboard → Settings → API |

### 3. Setup Database

Create a `trades` table in Supabase:

```sql
create table trades (
  id uuid default gen_random_uuid() primary key,
  symbol text not null,
  direction text not null check (direction in ('LONG', 'SHORT')),
  entry_price numeric not null,
  take_profit numeric not null,
  sl numeric not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED_WIN', 'CLOSED_LOSS')),
  pnl_percent numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Migrasi dari skema lama (`tp1` / `tp2` / `tp1_hit`): sesuaikan kolom lalu tutup trade yang masih `TP1_HIT` di Supabase, atau jalankan migrasi contoh:

```sql
alter table trades add column if not exists take_profit numeric;
update trades set take_profit = coalesce(tp2, tp1) where take_profit is null;
-- Setelah backfill, hapus kolom lama jika tidak dipakai lagi:
-- alter table trades drop column if exists tp1;
-- alter table trades drop column if exists tp2;
-- alter table trades drop column if exists tp1_hit;
```

### 4. Deploy to Vercel

```bash
npm run deploy
```

Set environment variables in Vercel Dashboard → Settings → Environment Variables.

### 5. Setup Cron Job

Configure Vercel Cron in `vercel.json` or use Vercel Dashboard → Settings → Cron Jobs:

```
Schedule: */15 * * * *    (every 15 minutes)
Endpoint: /api/cron/analyze?secret=YOUR_CRON_SECRET
```

### 6. Set Telegram Webhook

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_VERCEL_URL>/api/webhook/telegram"
```

---

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/status` | Check bot status and uptime |
| `/analyze <SYMBOL>` | Manually trigger analysis (e.g. `/analyze BTCUSDT`) |
| `/watchlist` | Show active watchlist |
| `/price <SYMBOL>` | Get current price (e.g. `/price ETHUSDT`) |
| `/pnl` | View trading performance report |
| `/help` | Show available commands |

---

## Configuration

All tunable parameters are in `src/config/constants.ts`:

```ts
// Indicators
EMA_FAST_PERIOD = 9
EMA_SLOW_PERIOD = 21
RSI_PERIOD = 14
RSI_OVERBOUGHT = 70
RSI_OVERSOLD = 30
ADX_TRENDING_THRESHOLD = 25
VOL_MULTIPLIER = 1.5

// Risk
SL_ATR_MULTIPLIER = 1.5
TP_ATR_MULTIPLIER = 3.0
MIN_RISK_REWARD = 2.0

// MTF Agreement
MIN_TF_AGREEMENT = 2          // min 2 of 3 timeframes must agree
ANALYSIS_TIMEFRAMES = ['4h', '1h', '15m']

// AI
MIN_AI_CONFIDENCE = 60        // minimum confidence to proceed
AI_FALLBACK_STRATEGY = 'moderate'  // 'strict' | 'moderate' | 'lenient'
AI_MAX_RETRIES = 3
AI_TIMEOUT_MS = 30_000

// Dedup
SIGNAL_COOLDOWN_MINUTES = 60  // prevent duplicate signal within 60m
```

### AI Fallback Strategies

| Strategy | Behavior |
|----------|----------|
| `strict` | Skip signal entirely if AI unavailable (safest) |
| `moderate` | Proceed with reduced confidence = 40 (default) |
| `lenient` | Proceed with confidence = 50 (least restrictive) |

---

## Project Structure

```
crypto-signal-bot/
├── api/
│   ├── cron/
│   │   └── analyze.ts          # Main cron endpoint (MTF + AI → Signal)
│   └── webhook/
│       └── telegram.ts          # Telegram webhook handler (commands)
├── src/
│   ├── config/
│   │   ├── constants.ts         # All tunable parameters
│   │   └── watchlist.ts         # Watchlist (BTCUSDT, ETHUSDT)
│   ├── services/
│   │   ├── analyzer.ts          # Multi-timeframe analysis logic
│   │   ├── binance.ts           # Binance Futures API client (with retry)
│   │   ├── indicators.ts        # Technical indicator calculations
│   │   ├── researcher.ts        # Gemini AI research service
│   │   ├── supabase.ts          # Database operations
│   │   ├── telegram.ts          # Telegram message formatting & sending
│   │   └── tracker.ts           # Paper trade evaluation
│   └── types/
│       └── index.ts             # TypeScript interfaces
├── scripts/
│   ├── backtest.ts              # Backtest engine
│   └── downloadKlines.ts        # Historical data downloader
├── .env.example
├── vercel.json
└── package.json
```

---

## Scripts

### Download Historical Data

```bash
npx tsx scripts/downloadKlines.ts BTCUSDT 90
```

Downloads 90 days of 15m/1h/4h candles to `.data/` for backtesting.

### Backtest

```bash
npx tsx scripts/backtest.ts BTCUSDT
```

Runs backtest using downloaded data with full trade logic (single TP, SL, fees).

### Type Check

```bash
npm run type-check
```

### Deploy

```bash
npm run deploy
```

---

## License

Private. Not intended for public distribution.

---

## Disclaimer

This is a **paper trading bot** for educational purposes only. It does not execute real trades. Always do your own research before making any trading decisions. Past performance does not guarantee future results.

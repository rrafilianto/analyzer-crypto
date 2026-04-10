import { Timeframe } from '../types';

// ========================
// Indicator Settings
// ========================

export const EMA_FAST_PERIOD = 9;
export const EMA_SLOW_PERIOD = 21;

export const RSI_PERIOD = 14;
export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;

export const ATR_PERIOD = 14;

export const ADX_PERIOD = 14;
export const ADX_TRENDING_THRESHOLD = 25;

export const VOL_SMA_PERIOD = 20;
export const VOL_MULTIPLIER = 1.5;

// ========================
// Risk Management
// ========================

/** Stop Loss multiplier × ATR */
export const SL_ATR_MULTIPLIER = 1.5;

/** Take Profit 1 multiplier × ATR */
export const TP1_ATR_MULTIPLIER = 1.5;

/** Take Profit 2 multiplier × ATR */
export const TP2_ATR_MULTIPLIER = 3.0;

/** Minimum Risk/Reward ratio to accept a trade */
export const MIN_RISK_REWARD = 2.0;

// ========================
// MTF Agreement
// ========================

/** Minimum number of timeframes that must agree for a signal */
export const MIN_TF_AGREEMENT = 2;

/** Timeframes used in multi-timeframe analysis (ordered: trend → momentum → entry) */
export const ANALYSIS_TIMEFRAMES: Timeframe[] = ['4h', '1h', '15m'];

// ========================
// AI Researcher
// ========================

/** Minimum AI confidence score (0-100) to proceed with signal */
export const MIN_AI_CONFIDENCE = 50;

/** Gemini model to use */
export const GEMINI_MODEL = 'gemini-2.5-flash';

/** Fallback strategy when AI is unavailable:
 *  - 'strict': Skip the signal entirely (safest)
 *  - 'moderate': Proceed with reduced confidence = 40 (default)
 *  - 'lenient': Proceed with confidence = 50 (least restrictive)
 */
export const AI_FALLBACK_STRATEGY: 'strict' | 'moderate' | 'lenient' = 'moderate';

/** Max retry attempts for Gemini API calls */
export const AI_MAX_RETRIES = 3;

/** Timeout per Gemini API call (milliseconds) */
export const AI_TIMEOUT_MS = 30_000;

// ========================
// Signal Deduplication
// ========================

/** Cooldown window (minutes) before the same symbol+direction signal can be sent again */
export const SIGNAL_COOLDOWN_MINUTES = 60;

// ========================
// Binance API
// ========================

export const BINANCE_FUTURES_BASE_URL = 'https://fapi.binance.com';

/** Number of candles to fetch per timeframe (enough for EMA21 + RSI14 + ATR14 warmup) */
export const CANDLE_LIMIT = 100;

// ========================
// Timeframe Labels
// ========================

export const TF_LABELS: Record<Timeframe, string> = {
  '4h': '4H (Trend)',
  '1h': '1H (Momentum)',
  '15m': '15M (Entry)',
};

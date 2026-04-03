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

// ========================
// Risk Management
// ========================

/** Stop Loss multiplier × ATR */
export const SL_ATR_MULTIPLIER = 1.5;

/** Take Profit multiplier × ATR — gives 1:2 R/R ratio */
export const TP_ATR_MULTIPLIER = 3.0;

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
export const MIN_AI_CONFIDENCE = 60;

/** Gemini model to use */
export const GEMINI_MODEL = 'gemini-2.5-flash';

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

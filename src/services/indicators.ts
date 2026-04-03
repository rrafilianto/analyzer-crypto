import { EMA, RSI, ATR } from 'technicalindicators';
import { Candle, EMAResult, RSIResult, ATRResult, IndicatorSnapshot, SignalDirection } from '../types';
import {
  EMA_FAST_PERIOD,
  EMA_SLOW_PERIOD,
  RSI_PERIOD,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  ATR_PERIOD,
  SL_ATR_MULTIPLIER,
  TP_ATR_MULTIPLIER,
} from '../config/constants';

/**
 * Calculate EMA crossover trend.
 * Bullish: EMA9 > EMA21
 * Bearish: EMA9 < EMA21
 */
export function calculateEMA(candles: Candle[]): EMAResult {
  const closes = candles.map((c) => c.close);

  const ema9Values = EMA.calculate({ period: EMA_FAST_PERIOD, values: closes });
  const ema21Values = EMA.calculate({ period: EMA_SLOW_PERIOD, values: closes });

  const ema9 = ema9Values[ema9Values.length - 1];
  const ema21 = ema21Values[ema21Values.length - 1];

  let trend: SignalDirection = 'NEUTRAL';
  if (ema9 > ema21) trend = 'LONG';
  else if (ema9 < ema21) trend = 'SHORT';

  return { ema9, ema21, trend };
}

/**
 * Calculate RSI with overbought/oversold classification.
 */
export function calculateRSI(candles: Candle[]): RSIResult {
  const closes = candles.map((c) => c.close);

  const rsiValues = RSI.calculate({ period: RSI_PERIOD, values: closes });
  const value = rsiValues[rsiValues.length - 1];

  let condition: RSIResult['condition'] = 'NEUTRAL';
  if (value >= RSI_OVERBOUGHT) condition = 'OVERBOUGHT';
  else if (value <= RSI_OVERSOLD) condition = 'OVERSOLD';

  return { value: Math.round(value * 100) / 100, condition };
}

/**
 * Calculate ATR for dynamic SL/TP levels.
 */
export function calculateATR(
  candles: Candle[],
  currentPrice: number,
  direction: SignalDirection
): ATRResult {
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);

  const atrValues = ATR.calculate({ period: ATR_PERIOD, high, low, close });
  const value = atrValues[atrValues.length - 1];

  let stopLoss: number;
  let takeProfit: number;

  if (direction === 'LONG') {
    stopLoss = currentPrice - value * SL_ATR_MULTIPLIER;
    takeProfit = currentPrice + value * TP_ATR_MULTIPLIER;
  } else if (direction === 'SHORT') {
    stopLoss = currentPrice + value * SL_ATR_MULTIPLIER;
    takeProfit = currentPrice - value * TP_ATR_MULTIPLIER;
  } else {
    // Neutral — calculate as if LONG for reference
    stopLoss = currentPrice - value * SL_ATR_MULTIPLIER;
    takeProfit = currentPrice + value * TP_ATR_MULTIPLIER;
  }

  return {
    value: Math.round(value * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit: Math.round(takeProfit * 100) / 100,
  };
}

/**
 * Calculate all indicators for a set of candles and determine direction.
 */
export function calculateIndicators(
  candles: Candle[],
  currentPrice: number
): IndicatorSnapshot {
  const ema = calculateEMA(candles);
  const rsi = calculateRSI(candles);

  // Determine direction based on EMA trend + RSI confirmation
  let direction: SignalDirection = ema.trend;

  // RSI divergence filter: if EMA says LONG but RSI is overbought, downgrade to NEUTRAL
  if (direction === 'LONG' && rsi.condition === 'OVERBOUGHT') {
    direction = 'NEUTRAL';
  }
  // If EMA says SHORT but RSI is oversold, downgrade to NEUTRAL
  if (direction === 'SHORT' && rsi.condition === 'OVERSOLD') {
    direction = 'NEUTRAL';
  }

  const atr = calculateATR(candles, currentPrice, direction);

  return { ema, rsi, atr, direction };
}

import {
  EMA, RSI, ATR, SMA, ADX,
  bullishengulfingpattern, bearishengulfingpattern,
  morningstar, eveningstar,
  piercingline, darkcloudcover
} from 'technicalindicators';
import { Candle, EMAResult, RSIResult, ATRResult, VolumeResult, PatternResult, RegimeResult, IndicatorSnapshot, SignalDirection } from '../types';
import {
  EMA_FAST_PERIOD,
  EMA_SLOW_PERIOD,
  RSI_PERIOD,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  ATR_PERIOD,
  ADX_PERIOD,
  ADX_TRENDING_THRESHOLD,
  VOL_SMA_PERIOD,
  VOL_MULTIPLIER,
  SL_ATR_MULTIPLIER,
  TP1_ATR_MULTIPLIER,
  TP2_ATR_MULTIPLIER,
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
  let takeProfit1: number;
  let takeProfit2: number;

  if (direction === 'LONG') {
    stopLoss = currentPrice - value * SL_ATR_MULTIPLIER;
    takeProfit1 = currentPrice + value * TP1_ATR_MULTIPLIER;
    takeProfit2 = currentPrice + value * TP2_ATR_MULTIPLIER;
  } else if (direction === 'SHORT') {
    stopLoss = currentPrice + value * SL_ATR_MULTIPLIER;
    takeProfit1 = currentPrice - value * TP1_ATR_MULTIPLIER;
    takeProfit2 = currentPrice - value * TP2_ATR_MULTIPLIER;
  } else {
    // Neutral — calculate as if LONG for reference
    stopLoss = currentPrice - value * SL_ATR_MULTIPLIER;
    takeProfit1 = currentPrice + value * TP1_ATR_MULTIPLIER;
    takeProfit2 = currentPrice + value * TP2_ATR_MULTIPLIER;
  }

  return {
    value: Math.round(value * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit1: Math.round(takeProfit1 * 100) / 100,
    takeProfit2: Math.round(takeProfit2 * 100) / 100,
  };
}

/**
 * Calculate SMA for Volume to check for spikes.
 */
export function calculateVolume(candles: Candle[]): VolumeResult {
  const volumes = candles.map((c) => c.volume);
  const smaValues = SMA.calculate({ period: VOL_SMA_PERIOD, values: volumes });

  const currentVol = volumes[volumes.length - 1];
  const smaVol = smaValues[smaValues.length - 1];

  const isConfirmed = currentVol >= smaVol * VOL_MULTIPLIER;

  return {
    sma: Math.round(smaVol * 100) / 100,
    current: Math.round(currentVol * 100) / 100,
    isConfirmed,
  };
}

/**
 * Calculate ADX to determine market regime (Trending vs Choppy/Ranging).
 */
export function calculateRegime(candles: Candle[]): RegimeResult {
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);

  const adxValues = ADX.calculate({ period: ADX_PERIOD, high, low, close });

  if (adxValues.length === 0) {
    return { value: 0, isTrending: false };
  }

  const latest = adxValues[adxValues.length - 1];
  const value = Math.round(latest.adx * 100) / 100;
  const isTrending = value >= ADX_TRENDING_THRESHOLD;

  return { value, isTrending };
}

/**
 * Detect Candlestick Patterns
 */
export function calculateCandlestickPattern(
  candles: Candle[],
  direction: SignalDirection
): PatternResult {
  if (candles.length < 5) return { detected: null };
  const recent = candles.slice(-5);
  const input = {
    open: recent.map((c) => c.open),
    high: recent.map((c) => c.high),
    low: recent.map((c) => c.low),
    close: recent.map((c) => c.close),
  };

  let detected: string | null = null;
  if (direction === 'LONG') {
    if (bullishengulfingpattern(input)) detected = 'Bullish Engulfing';
    else if (morningstar(input)) detected = 'Morning Star';
    else if (piercingline(input)) detected = 'Piercing Line';
  } else if (direction === 'SHORT') {
    if (bearishengulfingpattern(input)) detected = 'Bearish Engulfing';
    else if (eveningstar(input)) detected = 'Evening Star';
    else if (darkcloudcover(input)) detected = 'Dark Cloud Cover';
  }

  return { detected };
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
  const volume = calculateVolume(candles);

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
  const pattern = calculateCandlestickPattern(candles, direction);
  const regime = calculateRegime(candles);

  return { ema, rsi, atr, volume, pattern, regime, direction };
}

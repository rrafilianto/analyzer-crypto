import {
  Candle,
  Timeframe,
  TimeframeAnalysis,
  MTFAnalysisResult,
  SignalDirection,
} from '../types';
import { getCandlesAllTimeframes, getCurrentPrice } from './binance';
import { calculateIndicators } from './indicators';
import {
  ANALYSIS_TIMEFRAMES,
  MIN_TF_AGREEMENT,
} from '../config/constants';
import { BTC_SYMBOL } from '../config/watchlist';

/**
 * Analyze a single timeframe.
 */
function analyzeTimeframe(
  timeframe: Timeframe,
  candles: Candle[],
  currentPrice: number
): TimeframeAnalysis {
  const indicators = calculateIndicators(candles, currentPrice);

  return {
    timeframe,
    indicators,
    direction: indicators.direction,
  };
}

/**
 * Count signal agreements across timeframes.
 */
function countAgreement(analyses: Record<Timeframe, TimeframeAnalysis>) {
  let longCount = 0;
  let shortCount = 0;
  let neutralCount = 0;

  for (const tf of ANALYSIS_TIMEFRAMES) {
    const dir = analyses[tf].direction;
    if (dir === 'LONG') longCount++;
    else if (dir === 'SHORT') shortCount++;
    else neutralCount++;
  }

  const total = ANALYSIS_TIMEFRAMES.length;
  let direction: SignalDirection = 'NEUTRAL';
  let dominant = 0;

  if (longCount >= MIN_TF_AGREEMENT) {
    direction = 'LONG';
    dominant = longCount;
  } else if (shortCount >= MIN_TF_AGREEMENT) {
    direction = 'SHORT';
    dominant = shortCount;
  }

  return {
    longCount,
    shortCount,
    neutralCount,
    total,
    direction,
    strength: `${dominant || Math.max(longCount, shortCount)}/${total}`,
  };
}

/**
 * Get the current BTC trend direction for altcoin correlation filter.
 */
let cachedBTCTrend: { direction: SignalDirection; timestamp: number } | null = null;
const BTC_TREND_CACHE_MS = 5 * 60 * 1000; // Cache BTC trend for 5 minutes

export async function getBTCTrend(): Promise<SignalDirection> {
  // Return cached trend if fresh
  if (cachedBTCTrend && Date.now() - cachedBTCTrend.timestamp < BTC_TREND_CACHE_MS) {
    return cachedBTCTrend.direction;
  }

  const candles = await getCandlesAllTimeframes(BTC_SYMBOL, ['4h', '1h'] as Timeframe[]);
  const btcPrice = await getCurrentPrice(BTC_SYMBOL);

  const h4 = analyzeTimeframe('4h', candles['4h'], btcPrice);
  const h1 = analyzeTimeframe('1h', candles['1h'], btcPrice);

  // BTC trend = 4H direction, confirmed by 1H
  let direction: SignalDirection = 'NEUTRAL';
  if (h4.direction === h1.direction) {
    direction = h4.direction;
  } else {
    direction = h4.direction; // 4H takes priority
  }

  cachedBTCTrend = { direction, timestamp: Date.now() };
  return direction;
}

/**
 * Run full Multi-Timeframe Analysis (MTF) for a symbol.
 */
export async function analyzeSymbol(symbol: string): Promise<MTFAnalysisResult> {
  // Fetch all candles in parallel
  const candlesByTF = await getCandlesAllTimeframes(symbol, ANALYSIS_TIMEFRAMES);
  const currentPrice = await getCurrentPrice(symbol);

  // Analyze each timeframe
  const analyses: Partial<Record<Timeframe, TimeframeAnalysis>> = {};
  for (const tf of ANALYSIS_TIMEFRAMES) {
    analyses[tf] = analyzeTimeframe(tf, candlesByTF[tf], currentPrice);
  }

  const fullAnalyses = analyses as Record<Timeframe, TimeframeAnalysis>;

  // Count agreement
  const agreement = countAgreement(fullAnalyses);

  // Collect warnings instead of blocking signals
  const warnings: string[] = [];

  let shouldSignal = agreement.direction !== 'NEUTRAL';

  // BTC Trend Correlation — warning only, don't block
  if (shouldSignal && symbol !== BTC_SYMBOL) {
    const btcTrend = await getBTCTrend();

    // If BTC is bearish, warn about LONG signals on altcoins
    if (btcTrend === 'SHORT' && agreement.direction === 'LONG') {
      warnings.push(`BTC bearish (4H+1H) — signal LONG altcoin berlawanan tren`);
    }
    // If BTC is bullish, warn about SHORT signals on altcoins
    if (btcTrend === 'LONG' && agreement.direction === 'SHORT') {
      warnings.push(`BTC bullish (4H+1H) — signal SHORT altcoin berlawanan tren`);
    }
  }

  // Volume Confirmation — warning only, don't block
  if (shouldSignal && !fullAnalyses['15m'].indicators.volume.isConfirmed) {
    const vol = fullAnalyses['15m'].indicators.volume;
    warnings.push(`Volume lemah di 15M (${vol.current} vs SMA ${vol.sma}) — tidak ada spike`);
  }

  // Market Regime Detection — warning only, don't block
  if (shouldSignal && !fullAnalyses['4h'].indicators.regime.isTrending && !fullAnalyses['1h'].indicators.regime.isTrending) {
    const adx4h = fullAnalyses['4h'].indicators.regime.value;
    const adx1h = fullAnalyses['1h'].indicators.regime.value;
    warnings.push(`Market sedang ranging (ADX 4H: ${adx4h}, 1H: ${adx1h}) — sinyal kurang kuat`);
  }

  return {
    symbol,
    timestamp: Date.now(),
    analyses: fullAnalyses,
    agreement,
    shouldSignal,
    warnings,
  };
}

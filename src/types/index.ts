// ========================
// Candle & Market Data
// ========================

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export type Timeframe = '4h' | '1h' | '15m';

export type SignalDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

// ========================
// Indicator Results
// ========================

export interface EMAResult {
  ema9: number;
  ema21: number;
  trend: SignalDirection;
}

export interface RSIResult {
  value: number;
  condition: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
}

export interface ATRResult {
  value: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
}

export interface VolumeResult {
  sma: number;
  current: number;
  isConfirmed: boolean;
}

export interface PatternResult {
  detected: string | null;
}

export interface RegimeResult {
  value: number;
  isTrending: boolean;
}

export interface IndicatorSnapshot {
  ema: EMAResult;
  rsi: RSIResult;
  atr: ATRResult;
  volume: VolumeResult;
  pattern: PatternResult;
  regime: RegimeResult;
  direction: SignalDirection;
}

// ========================
// Multi-Timeframe Analysis
// ========================

export interface TimeframeAnalysis {
  timeframe: Timeframe;
  indicators: IndicatorSnapshot;
  direction: SignalDirection;
}

export interface MTFAnalysisResult {
  symbol: string;
  timestamp: number;
  analyses: Record<Timeframe, TimeframeAnalysis>;
  agreement: {
    longCount: number;
    shortCount: number;
    neutralCount: number;
    total: number;
    direction: SignalDirection;
    strength: string; // e.g. "3/3" or "2/3"
  };
  shouldSignal: boolean;
  warnings: string[];
}

// ========================
// AI Researcher
// ========================

export interface ResearchResult {
  confidence: number; // 0-100
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasoning: string;
  shouldProceed: boolean;
}

// ========================
// Trade Signal
// ========================

export interface TradeSignal {
  symbol: string;
  direction: SignalDirection;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskRewardRatio: number;
  strength: string;
  timeframeDetails: Record<Timeframe, TimeframeAnalysis>;
  aiResearch: ResearchResult;
  warnings: string[];
  timestamp: number;
}

// ========================
// API Response
// ========================

export interface CronResponse {
  success: boolean;
  timestamp: string;
  signalsGenerated: number;
  signals: TradeSignal[];
  skipped: Array<{ symbol: string; reason: string }>;
  errors: Array<{ symbol: string; error: string }>;
}

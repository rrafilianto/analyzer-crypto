import { Candle, Timeframe } from '../types';
import { BINANCE_FUTURES_BASE_URL, CANDLE_LIMIT } from '../config/constants';

/**
 * Fetch OHLCV candlestick data from Binance Futures public API.
 * No API key required for public market data.
 */
export async function getCandles(
  symbol: string,
  interval: Timeframe,
  limit: number = CANDLE_LIMIT
): Promise<Candle[]> {
  const url = `${BINANCE_FUTURES_BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Binance API error for ${symbol} ${interval}: ${response.status} — ${errorText}`
    );
  }

  const data = (await response.json()) as any[][];

  return data.map((k) => ({
    openTime: k[0] as number,
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
    closeTime: k[6] as number,
  }));
}

/**
 * Fetch candles for all 3 timeframes in parallel for a given symbol.
 */
export async function getCandlesAllTimeframes(
  symbol: string,
  timeframes: Timeframe[]
): Promise<Record<Timeframe, Candle[]>> {
  const results = await Promise.all(
    timeframes.map(async (tf) => {
      const candles = await getCandles(symbol, tf);
      return { tf, candles };
    })
  );

  const record: Partial<Record<Timeframe, Candle[]>> = {};
  for (const { tf, candles } of results) {
    record[tf] = candles;
  }

  return record as Record<Timeframe, Candle[]>;
}

/**
 * Get the current price of a symbol (last close from 1m candle).
 */
export async function getCurrentPrice(symbol: string): Promise<number> {
  const url = `${BINANCE_FUTURES_BASE_URL}/fapi/v1/ticker/price?symbol=${symbol}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to get price for ${symbol}: ${response.status}`);
  }

  const data = (await response.json()) as { price: string };
  return parseFloat(data.price);
}

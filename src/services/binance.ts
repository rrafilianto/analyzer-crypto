import { Candle, Timeframe } from '../types';
import { BINANCE_FUTURES_BASE_URL, CANDLE_LIMIT } from '../config/constants';

// ========================
// Retry Configuration
// ========================

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // Start delay: 2s

/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with exponential backoff retry.
 * Retries on network errors and 5xx server errors.
 */
async function fetchWithRetry(
  url: string,
  context: string,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);

      // Retry on 5xx server errors
      if (response.status >= 500) {
        const errorText = await response.text();
        lastError = new Error(`${response.status} — ${errorText}`);
        console.warn(`[Binance] ${context} attempt ${attempt}/${retries} failed: ${lastError.message}`);

        if (attempt < retries) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[Binance] Retrying in ${delay / 1000}s...`);
          await sleep(delay);
        }
        continue;
      }

      // Success or non-retryable error (4xx)
      return response;
    } catch (error: any) {
      lastError = error;
      console.warn(`[Binance] ${context} attempt ${attempt}/${retries} failed: ${error.message}`);

      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[Binance] Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  throw new Error(
    `${context} failed after ${retries} attempts: ${lastError?.message ?? 'unknown error'}`
  );
}

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
  const context = `getCandles(${symbol} ${interval})`;

  const response = await fetchWithRetry(url, context);

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
  const context = `getCurrentPrice(${symbol})`;

  const response = await fetchWithRetry(url, context);

  if (!response.ok) {
    throw new Error(`Failed to get price for ${symbol}: ${response.status}`);
  }

  const data = (await response.json()) as { price: string };
  return parseFloat(data.price);
}

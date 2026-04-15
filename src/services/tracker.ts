import { getCandlesAllTimeframes } from './binance';
import { getOpenTrades, updateTradeStatus, DBTrade } from './supabase';
import { sendTrackerAlert } from './telegram';
import { ANALYSIS_TIMEFRAMES } from '../config/constants';

const FEE_PERCENT = 0.002;

/**
 * Checks all open trades for a symbol, evaluates them against the latest prices,
 * updates the DB, sends Telegram alerts if status changed, and returns TRUE if
 * there are ANY active trades still open (to block new signals).
 */
export async function evaluateOpenTrades(symbol: string): Promise<boolean> {
  const openTrades = await getOpenTrades(symbol);

  if (openTrades.length === 0) return false;

  const allCandles = await getCandlesAllTimeframes(symbol, ANALYSIS_TIMEFRAMES);
  const tf15m = allCandles['15m'];
  if (!tf15m || tf15m.length === 0) {
    return true; // Safely assume trade is still active if API fails
  }

  const candlesToCheck = tf15m.slice(-2);
  let hasActiveTrade = false;

  for (const trade of openTrades) {
    const isLong = trade.direction === 'LONG';
    const currentState = trade.status;
    let newStatus = currentState;

    for (const candle of candlesToCheck) {
      if (newStatus !== 'OPEN') continue;

      const hitSL = isLong ? candle.low <= trade.sl : candle.high >= trade.sl;
      const hitTP = isLong ? candle.high >= trade.take_profit : candle.low <= trade.take_profit;

      // Pessimistic: SL before TP on the same candle
      if (hitSL) {
        newStatus = 'CLOSED_LOSS';
        const exitPrice = trade.sl;
        const gross = isLong
          ? (exitPrice - trade.entry_price) / trade.entry_price
          : (trade.entry_price - exitPrice) / trade.entry_price;
        trade.pnl_percent = (gross - FEE_PERCENT) * 100;
        break;
      }
      if (hitTP) {
        newStatus = 'CLOSED_WIN';
        const exitPrice = trade.take_profit;
        const gross = isLong
          ? (exitPrice - trade.entry_price) / trade.entry_price
          : (trade.entry_price - exitPrice) / trade.entry_price;
        trade.pnl_percent = (gross - FEE_PERCENT) * 100;
        break;
      }
    }

    if (newStatus !== currentState) {
      trade.status = newStatus as DBTrade['status'];

      await updateTradeStatus(trade.id, {
        status: trade.status,
        pnl_percent: trade.pnl_percent,
      });

      if (['CLOSED_WIN', 'CLOSED_LOSS'].includes(trade.status)) {
        await sendTrackerAlert(trade, trade.status);
      }
    }

    if (trade.status === 'OPEN') {
      hasActiveTrade = true;
    }
  }

  return hasActiveTrade;
}

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

  // Look at the last 2 candles
  const candlesToCheck = tf15m.slice(-2); 
  let hasActiveTrade = false;

  for (const trade of openTrades) {
    const isLong = trade.direction === 'LONG';
    const currentState = trade.status;
    let newStatus = currentState;
    let exitPrice = 0;
    let tp1HitFlag = trade.tp1_hit;
    
    for (const candle of candlesToCheck) {
      if (newStatus !== 'OPEN' && newStatus !== 'TP1_HIT') continue;

      const hitSL = isLong ? candle.low <= trade.sl : candle.high >= trade.sl;
      const hitTP1 = isLong ? candle.high >= trade.tp1 : candle.low <= trade.tp1;
      const hitTP2 = isLong ? candle.high >= trade.tp2 : candle.low <= trade.tp2;

      if (!tp1HitFlag) {
         // Pesimistic approach: evaluate SL first
        if (hitSL) {
          newStatus = 'CLOSED_LOSS'; exitPrice = trade.sl;
          const gross = isLong ? (exitPrice - trade.entry_price)/trade.entry_price : (trade.entry_price - exitPrice)/trade.entry_price;
          trade.pnl_percent = (gross - FEE_PERCENT) * 100;
          break;
        } else if (hitTP1) {
          tp1HitFlag = true;
          newStatus = 'TP1_HIT';
          trade.sl = trade.entry_price; // BE Tracker
        }
      }

      if (tp1HitFlag && (newStatus === 'OPEN' || newStatus === 'TP1_HIT')) {
        const hitBESL = isLong ? candle.low <= trade.sl : candle.high >= trade.sl;
        if (hitTP2) {
          newStatus = 'CLOSED_WIN'; exitPrice = trade.tp2;
        } else if (hitBESL) {
          newStatus = 'CLOSED_BE'; exitPrice = trade.entry_price;
        }

        if (newStatus === 'CLOSED_WIN' || newStatus === 'CLOSED_BE') {
          const gross1 = isLong ? (trade.tp1 - trade.entry_price)/trade.entry_price : (trade.entry_price - trade.tp1)/trade.entry_price;
          const gross2 = isLong ? (exitPrice - trade.entry_price)/trade.entry_price : (trade.entry_price - exitPrice)/trade.entry_price;
          const blendedGross = (gross1 * 0.75) + (gross2 * 0.25);
          trade.pnl_percent = (blendedGross - FEE_PERCENT) * 100;
          break;
        }
      }
    }

    if (newStatus !== currentState || tp1HitFlag !== trade.tp1_hit) {
      trade.status = newStatus as 'OPEN' | 'TP1_HIT' | 'CLOSED_WIN' | 'CLOSED_LOSS' | 'CLOSED_BE';
      trade.tp1_hit = tp1HitFlag;

      await updateTradeStatus(trade.id, {
        status: trade.status,
        tp1_hit: trade.tp1_hit,
        sl: trade.sl,
        pnl_percent: trade.pnl_percent
      });

      if (trade.status === 'TP1_HIT' && currentState !== 'TP1_HIT') {
        await sendTrackerAlert(trade, 'TP1_HIT');
      } else if (['CLOSED_WIN', 'CLOSED_BE', 'CLOSED_LOSS'].includes(trade.status)) {
        await sendTrackerAlert(trade, trade.status);
      }
    }

    if (trade.status === 'OPEN' || trade.status === 'TP1_HIT') {
      hasActiveTrade = true;
    }
  }

  return hasActiveTrade;
}

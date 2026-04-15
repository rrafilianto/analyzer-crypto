import fs from 'fs';
import path from 'path';
import { Candle, Timeframe } from '../src/types';
import { ANALYSIS_TIMEFRAMES, MIN_TF_AGREEMENT, MIN_RISK_REWARD } from '../src/config/constants';
import { calculateIndicators } from '../src/services/indicators';

// 1. Re-implement analyzeTimeframe
function analyzeTimeframe(timeframe: Timeframe, candles: Candle[], currentPrice: number) {
  const indicators = calculateIndicators(candles, currentPrice);
  return { timeframe, indicators, direction: indicators.direction };
}

// 2. Re-implement countAgreement
function countAgreement(analyses: any) {
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
  let direction = 'NEUTRAL';
  let dominant = 0;

  if (longCount >= MIN_TF_AGREEMENT) {
    direction = 'LONG';
    dominant = longCount;
  } else if (shortCount >= MIN_TF_AGREEMENT) {
    direction = 'SHORT';
    dominant = shortCount;
  }

  return { direction, strength: `${dominant || Math.max(longCount, shortCount)}/${total}` };
}

async function backtest() {
  const args = process.argv.slice(2);
  const symbol = args[0] || 'BTCUSDT';
  const dataDir = path.join(process.cwd(), '.data');
  
  const tfData: Record<string, Candle[]> = {};
  for (const tf of ANALYSIS_TIMEFRAMES) {
    const file = path.join(dataDir, `${symbol}-${tf}.json`);
    if(!fs.existsSync(file)) throw new Error(`Missing ${file}. Run downloadKlines.ts first!`);
    tfData[tf] = JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  const baseTf = '15m'; // Entry Base
  const baseCandles = tfData[baseTf];

  // We need at least 100 4H candles (400 hours) to warmup EMA21
  const first4hTime = tfData['4h'][0].openTime;
  const warmupMs = 100 * 4 * 60 * 60 * 1000;
  const startEvalTime = first4hTime + warmupMs;

  let startIndex = 0;
  while(startIndex < baseCandles.length && baseCandles[startIndex].closeTime < startEvalTime) {
    startIndex++;
  }

  let activeTrades: any[] = [];
  let closedTrades: any[] = [];
  let currentPnl = 0;

  console.log(`Starting backtest for ${symbol}... (${baseCandles.length - startIndex} candles to evaluate)`);

  for(let i = startIndex; i < baseCandles.length; i++) {
    const current15mCandle = baseCandles[i];
    const currentTime = current15mCandle.closeTime;
    const currentPrice = current15mCandle.close;

    // Check Open Trades
    for(let t = activeTrades.length - 1; t >= 0; t--) {
      const trade = activeTrades[t];
      const isLong = trade.direction === 'LONG';
      const FEE_PERCENT = 0.002; // Total Round-trip Fee (0.1% open + 0.1% close)

      let closed = false;
      let exitPrice = 0;
      let reason = '';

      const hitSL = isLong ? current15mCandle.low <= trade.stopLoss : current15mCandle.high >= trade.stopLoss;
      const hitTP = isLong ? current15mCandle.high >= trade.takeProfit : current15mCandle.low <= trade.takeProfit;

      if (hitSL) {
        closed = true;
        exitPrice = trade.stopLoss;
        reason = 'Stop Loss';
        const gross = isLong ? (exitPrice - trade.entry)/trade.entry : (trade.entry - exitPrice)/trade.entry;
        trade.pnlPercent = (gross - FEE_PERCENT) * 100;
      } else if (hitTP) {
        closed = true;
        exitPrice = trade.takeProfit;
        reason = 'Take Profit';
        const gross = isLong ? (exitPrice - trade.entry)/trade.entry : (trade.entry - exitPrice)/trade.entry;
        trade.pnlPercent = (gross - FEE_PERCENT) * 100;
      }

      if (closed) {
        currentPnl += trade.pnlPercent;
        closedTrades.push({ ...trade, exitPrice, exitTime: currentTime, reason });
        activeTrades.splice(t, 1);
      }
    }

    if (activeTrades.length > 0) continue; // Max 1 active trade at a time

    // Build sliding windows
    const window15m = baseCandles.slice(i - 99, i + 1);
    
    // Efficiently slice 1H
    const all1h = tfData['1h'];
    const idx1h = all1h.findIndex(c => c.closeTime > currentTime);
    const split1h = idx1h === -1 ? all1h.length : idx1h;
    const window1h = all1h.slice(Math.max(0, split1h - 100), split1h);

    // Efficiently slice 4H
    const all4h = tfData['4h'];
    const idx4h = all4h.findIndex(c => c.closeTime > currentTime);
    const split4h = idx4h === -1 ? all4h.length : idx4h;
    const window4h = all4h.slice(Math.max(0, split4h - 100), split4h);

    if (window15m.length < 100 || window1h.length < 100 || window4h.length < 100) continue;

    const analyses: any = {
      '15m': analyzeTimeframe('15m', window15m, currentPrice),
      '1h': analyzeTimeframe('1h', window1h, currentPrice),
      '4h': analyzeTimeframe('4h', window4h, currentPrice),
    };

    const agreement = countAgreement(analyses);
    let shouldSignal = agreement.direction !== 'NEUTRAL';

    // Relaxed filters — warnings only, don't block signals
    // (BTC trend, volume, ADX are now informational warnings in live bot)

    if (shouldSignal) {
      const atr = analyses['15m'].indicators.atr;
      const riskDist = Math.abs(currentPrice - atr.stopLoss);
      const rewardDist = Math.abs(atr.takeProfit - currentPrice);
      const rr = riskDist > 0 ? rewardDist / riskDist : 0;
      if (rr >= MIN_RISK_REWARD) {
        activeTrades.push({
          direction: agreement.direction,
          entry: currentPrice,
          entryTime: currentTime,
          stopLoss: atr.stopLoss,
          takeProfit: atr.takeProfit,
        });
      }
    }
  }

  // Generate Report
  const tpHits = closedTrades.filter(t => t.reason === 'Take Profit');
  const winTrades = tpHits.length;
  const lossTrades = closedTrades.filter(t => t.reason === 'Stop Loss');
  const winRate = closedTrades.length > 0 ? ((winTrades / closedTrades.length) * 100).toFixed(2) : '0.00';

  // Count warnings that would have been triggered
  let warningCounts = { btcConflict: 0, lowVolume: 0, ranging: 0 };

  let maxDrawdown = 0;
  let peak = 0;
  let runningPnl = 0;
  for(const t of closedTrades) {
    runningPnl += t.pnlPercent;
    if(runningPnl > peak) peak = runningPnl;
    const dd = peak - runningPnl;
    if(dd > maxDrawdown) maxDrawdown = dd;
  }

  console.log(`\n============== BACKTEST REPORT ==============`);
  console.log(`Asset: ${symbol}`);
  console.log(`Strategy: Relaxed filters (warnings only)`);
  console.log(`Total Trades Taken: ${closedTrades.length}`);
  console.log(`- Take Profit: ${tpHits.length} trades`);
  console.log(`- Stop Loss: ${lossTrades.length} trades`);
  console.log(`Win Rate (TP Hit): ${winRate}%`);
  console.log(`Max Drawdown: -${maxDrawdown.toFixed(2)}%`);
  console.log(`Net Compounded PnL AFTER FEES (1x Lev): ${currentPnl > 0 ? '+' : ''}${currentPnl.toFixed(2)}%`);
  console.log(`=============================================\n`);
}

backtest().catch(console.error);

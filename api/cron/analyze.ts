import type { VercelRequest, VercelResponse } from '@vercel/node';
import { analyzeSymbol } from '../../src/services/analyzer';
import { researchSignal } from '../../src/services/researcher';
import { sendSignal, sendScanSummary } from '../../src/services/telegram';
import { getCurrentPrice } from '../../src/services/binance';
import { WATCHLIST } from '../../src/config/watchlist';
import { MIN_AI_CONFIDENCE } from '../../src/config/constants';
import { TradeSignal, CronResponse } from '../../src/types';

/**
 * Main cron endpoint — triggered every 15 minutes.
 *
 * Flow: Scan → Analyze (MTF) → Research (AI) → Signal (Telegram)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Security: verify cron secret (protection from unauthorized triggers)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    const querySecret = req.query.secret;

    if (authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log(`[Cron] Starting analysis cycle at ${new Date().toISOString()}`);

  const result: CronResponse = {
    success: true,
    timestamp: new Date().toISOString(),
    signalsGenerated: 0,
    signals: [],
    skipped: [],
    errors: [],
  };

  // Process each symbol
  for (const symbol of WATCHLIST) {
    try {
      console.log(`[Cron] Analyzing ${symbol}...`);

      // Step 1: Multi-Timeframe Technical Analysis
      const analysis = await analyzeSymbol(symbol);

      if (!analysis.shouldSignal) {
        const reason = analysis.agreement.direction === 'NEUTRAL'
          ? `No MTF agreement (L:${analysis.agreement.longCount} S:${analysis.agreement.shortCount} N:${analysis.agreement.neutralCount})`
          : `BTC trend conflict — signal ${analysis.agreement.direction} blocked`;

        result.skipped.push({ symbol, reason });
        console.log(`[Cron] ${symbol}: SKIP — ${reason}`);
        continue;
      }

      // Step 2: AI Research validation
      const research = await researchSignal(analysis);

      if (!research.shouldProceed) {
        result.skipped.push({
          symbol,
          reason: `AI rejected (confidence: ${research.confidence}/100): ${research.reasoning}`,
        });
        console.log(`[Cron] ${symbol}: SKIP — AI rejected (${research.confidence}/100)`);
        continue;
      }

      // Step 3: Build trade signal
      const currentPrice = await getCurrentPrice(symbol);

      // Use 15M ATR for precise entry SL/TP
      const entryTF = analysis.analyses['15m'];
      const atr = entryTF.indicators.atr;

      const signal: TradeSignal = {
        symbol,
        direction: analysis.agreement.direction,
        entry: currentPrice,
        stopLoss: atr.stopLoss,
        takeProfit1: atr.takeProfit1,
        takeProfit2: atr.takeProfit2,
        riskRewardRatio:
          Math.abs(atr.takeProfit2 - currentPrice) /
          Math.abs(currentPrice - atr.stopLoss),
        strength: analysis.agreement.strength,
        timeframeDetails: analysis.analyses,
        aiResearch: research,
        timestamp: Date.now(),
      };

      // Step 4: Send Telegram alert
      await sendSignal(signal);

      result.signals.push(signal);
      result.signalsGenerated++;
      console.log(`[Cron] ${symbol}: ✅ SIGNAL SENT — ${signal.direction} (${signal.strength})`);

      // Small delay between symbols to avoid rate limits
      await new Promise((r) => setTimeout(r, 500));
    } catch (error: any) {
      console.error(`[Cron] ${symbol}: ERROR — ${error.message}`);
      result.errors.push({ symbol, error: error.message });
    }
  }

  // Send summary if there were errors
  await sendScanSummary(result);

  console.log(
    `[Cron] Cycle complete. Signals: ${result.signalsGenerated}, Skipped: ${result.skipped.length}, Errors: ${result.errors.length}`
  );

  return res.status(200).json(result);
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { analyzeSymbol } from '../../src/services/analyzer';
import { researchSignal } from '../../src/services/researcher';
import { sendSignal, sendScanSummary } from '../../src/services/telegram';
import { getCurrentPrice } from '../../src/services/binance';
import { evaluateOpenTrades } from '../../src/services/tracker';
import { insertNewTrade, checkRecentSignal } from '../../src/services/supabase';
import { WATCHLIST } from '../../src/config/watchlist';
import { MIN_AI_CONFIDENCE, SIGNAL_COOLDOWN_MINUTES } from '../../src/config/constants';
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

      // TRACKER: Evaluate open trades first
      const hasActiveTrade = await evaluateOpenTrades(symbol);
      if (hasActiveTrade) {
        result.skipped.push({ symbol, reason: `Active trade exists in DB` });
        console.log(`[Cron] ${symbol}: SKIP — Active trade is still open in Supabase.`);
        continue;
      }

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

      // Log any warnings from analysis
      if (analysis.warnings.length > 0) {
        console.log(`[Cron] ${symbol}: WARNINGS — ${analysis.warnings.join(' | ')}`);
      }

      // Step 2: AI Research validation
      const research = await researchSignal(analysis);

      // AI no longer blocks signals — low confidence is just a warning
      if (!research.shouldProceed) {
        console.log(`[Cron] ${symbol}: AI warning (confidence: ${research.confidence}/100): ${research.reasoning}`);
      }

      // Step 2.5: Duplicate Signal Prevention — check cooldown
      const signalDirection = analysis.agreement.direction;
      if (signalDirection === 'NEUTRAL') {
        result.skipped.push({ symbol, reason: 'Signal direction is NEUTRAL' });
        continue;
      }

      const hasRecentSignal = await checkRecentSignal(
        symbol,
        signalDirection,
        SIGNAL_COOLDOWN_MINUTES
      );

      if (hasRecentSignal) {
        result.skipped.push({
          symbol,
          reason: `Duplicate prevention — ${signalDirection} signal sent within last ${SIGNAL_COOLDOWN_MINUTES}m`,
        });
        console.log(`[Cron] ${symbol}: SKIP — Duplicate signal (cooldown ${SIGNAL_COOLDOWN_MINUTES}m)`);
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
        warnings: analysis.warnings,
        timestamp: Date.now(),
      };

      // Step 4: Save Tracker & Send Telegram alert
      await insertNewTrade(signal);
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

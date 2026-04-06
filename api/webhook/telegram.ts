import type { VercelRequest, VercelResponse } from '@vercel/node';
import { analyzeSymbol } from '../../src/services/analyzer';
import { researchSignal } from '../../src/services/researcher';
import { sendSignal, sendStatus, sendRawMessage, sendPnlReport } from '../../src/services/telegram';
import { getCurrentPrice } from '../../src/services/binance';
import { WATCHLIST } from '../../src/config/watchlist';
import { TradeSignal } from '../../src/types';

/**
 * Telegram Webhook — handles bot commands.
 *
 * Commands:
 *   /status  — Check bot status
 *   /analyze <SYMBOL> — Manual trigger analysis for a symbol
 *   /watchlist — Show active watchlist
 *   /help — Show available commands
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;

    // Only handle text messages
    if (!update?.message?.text) {
      return res.status(200).json({ ok: true });
    }

    const chatId = update.message.chat.id.toString();
    const text = update.message.text.trim();
    const expectedChatId = process.env.TELEGRAM_CHAT_ID;

    // Security: only respond to authorized chat
    if (expectedChatId && chatId !== expectedChatId) {
      return res.status(200).json({ ok: true });
    }

    // Parse command
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase().replace('@', '').split('@')[0];

    switch (command) {
      case '/start':
      case '/help': {
        await sendRawMessage(
          `🤖 <b>Crypto Signal Bot</b>\n\n` +
          `Available commands:\n` +
          `  /status — Check bot status\n` +
          `  /analyze &lt;SYMBOL&gt; — Analyze a specific pair\n` +
          `  /watchlist — Show watchlist\n` +
          `  /price &lt;SYMBOL&gt; — Get current price\n` +
          `  /pnl — View trading performance\n` +
          `  /help — Show this message`
        );
        break;
      }

      case '/status': {
        const uptime = process.uptime?.() || 0;
        await sendStatus(
          `✅ Bot is running\n` +
          `📋 Watchlist: ${WATCHLIST.length} pairs\n` +
          `⏰ Server time: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`
        );
        break;
      }

      case '/watchlist': {
        const list = WATCHLIST.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
        await sendRawMessage(
          `📋 <b>Active Watchlist (${WATCHLIST.length} pairs)</b>\n\n${list}`
        );
        break;
      }

      case '/price': {
        const symbol = (parts[1] || '').toUpperCase();
        if (!symbol) {
          await sendRawMessage('❌ Usage: /price BTCUSDT');
          break;
        }

        const fullSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
        try {
          const price = await getCurrentPrice(fullSymbol);
          await sendRawMessage(
            `💰 <b>${fullSymbol}</b>\nPrice: <code>${price}</code> USDT`
          );
        } catch {
          await sendRawMessage(`❌ Could not fetch price for ${fullSymbol}`);
        }
        break;
      }

      case '/analyze': {
        const symbol = (parts[1] || '').toUpperCase();
        if (!symbol) {
          await sendRawMessage('❌ Usage: /analyze BTCUSDT');
          break;
        }

        const fullSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
        await sendRawMessage(`🔍 Analyzing <b>${fullSymbol}</b>... Please wait.`);

        try {
          const analysis = await analyzeSymbol(fullSymbol);

          if (!analysis.shouldSignal) {
            await sendRawMessage(
              `⚪ <b>${fullSymbol}</b> — No signal\n` +
              `Agreement: L:${analysis.agreement.longCount} S:${analysis.agreement.shortCount} N:${analysis.agreement.neutralCount}\n` +
              `Direction: ${analysis.agreement.direction || 'NEUTRAL'}`
            );
            break;
          }

          // Run AI research
          const research = await researchSignal(analysis);
          const currentPrice = await getCurrentPrice(fullSymbol);
          const entryTF = analysis.analyses['15m'];

          const signal: TradeSignal = {
            symbol: fullSymbol,
            direction: analysis.agreement.direction,
            entry: currentPrice,
            stopLoss: entryTF.indicators.atr.stopLoss,
            takeProfit1: entryTF.indicators.atr.takeProfit1,
            takeProfit2: entryTF.indicators.atr.takeProfit2,
            riskRewardRatio:
              Math.abs(entryTF.indicators.atr.takeProfit2 - currentPrice) /
              Math.abs(currentPrice - entryTF.indicators.atr.stopLoss),
            strength: analysis.agreement.strength,
            timeframeDetails: analysis.analyses,
            aiResearch: research,
            timestamp: Date.now(),
          };

          await sendSignal(signal);
        } catch (err: any) {
          await sendRawMessage(`❌ Error analyzing ${fullSymbol}: ${err.message}`);
        }
        break;
      }

      case '/pnl': {
        await sendPnlReport();
        break;
      }

      default: {
        await sendRawMessage(
          `❓ Unknown command. Type /help for available commands.`
        );
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('Webhook error:', error.message);
    return res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
}

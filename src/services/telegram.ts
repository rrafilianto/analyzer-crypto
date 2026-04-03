import { TradeSignal, MTFAnalysisResult, CronResponse } from '../types';
import { TF_LABELS, ANALYSIS_TIMEFRAMES } from '../config/constants';

const TELEGRAM_API = 'https://api.telegram.org/bot';

/**
 * Send a message to Telegram.
 */
async function sendMessage(text: string, parseMode: string = 'HTML'): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('Telegram credentials not configured');
    return;
  }

  const url = `${TELEGRAM_API}${token}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${response.status} — ${error}`);
  }
}

/**
 * Format a trade signal into a beautiful Telegram message.
 */
function formatSignalMessage(signal: TradeSignal): string {
  const emoji = signal.direction === 'LONG' ? '🟢' : '🔴';
  const dirLabel = signal.direction === 'LONG' ? 'LONG (BUY)' : 'SHORT (SELL)';

  // Format timeframe details
  const tfDetails = ANALYSIS_TIMEFRAMES.map((tf) => {
    const a = signal.timeframeDetails[tf];
    const { ema, rsi, volume, pattern, regime } = a.indicators;
    const dirEmoji = a.direction === 'LONG' ? '🟢' : a.direction === 'SHORT' ? '🔴' : '⚪';
    const volEmoji = volume.isConfirmed ? '🔥' : '📉';
    const patStr = pattern.detected ? ` | Pat: ${pattern.detected}` : '';
    const regimeStr = regime.isTrending ? '📈 Trend' : '📉 Range';
    return `  ${dirEmoji} ${TF_LABELS[tf]}: ${a.direction} | RSI: ${rsi.value} | ADX: ${regime.value} (${regimeStr}) | Vol: ${volEmoji}${patStr}`;
  }).join('\n');

  // Calculate percentages
  const slPercent = Math.abs(((signal.stopLoss - signal.entry) / signal.entry) * 100).toFixed(2);
  const tp1Percent = Math.abs(((signal.takeProfit1 - signal.entry) / signal.entry) * 100).toFixed(2);
  const tp2Percent = Math.abs(((signal.takeProfit2 - signal.entry) / signal.entry) * 100).toFixed(2);

  // Format price with appropriate decimals
  const formatPrice = (p: number) => {
    if (p >= 1000) return p.toFixed(2);
    if (p >= 1) return p.toFixed(4);
    return p.toFixed(6);
  };

  const timestamp = new Date(signal.timestamp).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${emoji} <b>${dirLabel} Signal — ${signal.symbol}</b>

📊 <b>Timeframe Agreement: ${signal.strength}</b>
${tfDetails}

💰 <b>Trade Setup:</b>
  ├─ Current Price: <code>${formatPrice(signal.entry)}</code>
  ├─ Stop Loss: <code>${formatPrice(signal.stopLoss)}</code> (-${slPercent}%)
  ├─ Take Profit 1: <code>${formatPrice(signal.takeProfit1)}</code> (+${tp1Percent}%)
  ├─ Take Profit 2: <code>${formatPrice(signal.takeProfit2)}</code> (+${tp2Percent}%)
  └─ Risk/Reward: <b>1:${signal.riskRewardRatio.toFixed(1)}</b>

🤖 <b>AI Researcher (Confidence: ${signal.aiResearch.confidence}/100):</b>
<i>"${signal.aiResearch.reasoning}"</i>

⏱ ${timestamp} WIB`;
}

/**
 * Format a skip notification
 */
function formatSkipMessage(symbol: string, reason: string): string {
  return `⚪ <b>SKIP — ${symbol}</b>\n<i>${reason}</i>`;
}

/**
 * Send a trade signal to Telegram.
 */
export async function sendSignal(signal: TradeSignal): Promise<void> {
  const message = formatSignalMessage(signal);
  await sendMessage(message);
}

/**
 * Send a summary of the full scan cycle.
 */
export async function sendScanSummary(result: CronResponse): Promise<void> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Only send summary if there were signals or errors
  if (result.signalsGenerated === 0 && result.errors.length === 0) {
    // Silent when no signals — don't spam Telegram
    console.log(`[${timestamp}] Scan complete. No signals generated.`);
    return;
  }

  if (result.errors.length > 0) {
    const errorList = result.errors
      .map((e) => `  ⚠️ ${e.symbol}: ${e.error}`)
      .join('\n');

    await sendMessage(
      `⚠️ <b>Scan Errors (${timestamp} WIB)</b>\n${errorList}`
    );
  }
}

/**
 * Send a status/heartbeat message.
 */
export async function sendStatus(message: string): Promise<void> {
  await sendMessage(`ℹ️ <b>Bot Status</b>\n${message}`);
}

/**
 * Send a raw text message.
 */
export async function sendRawMessage(text: string): Promise<void> {
  await sendMessage(text, 'HTML');
}

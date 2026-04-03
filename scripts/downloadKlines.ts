import fs from 'fs';
import path from 'path';

const BINANCE_FUTURES_BASE_URL = 'https://fapi.binance.com';

async function downloadKlines(symbol: string, interval: string, days: number) {
  const limit = 1500;
  const now = Date.now();
  const startTimeMs = now - days * 24 * 60 * 60 * 1000;
  let currentEndTime = now;
  let allCandles: any[] = [];

  console.log(`Downloading ${symbol} ${interval} for the last ${days} days...`);

  while (currentEndTime > startTimeMs) {
    const url = `${BINANCE_FUTURES_BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&endTime=${currentEndTime}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    if (data.length === 0) break;

    const mapped = data.map((k: any) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));

    allCandles = [...mapped, ...allCandles];
    
    const oldestTimestamp = mapped[0].openTime;
    currentEndTime = oldestTimestamp - 1;

    console.log(`Fetched ${mapped.length} candles, oldest: ${new Date(oldestTimestamp).toISOString()}`);
    
    // Safety delay to avoid rate limit
    await new Promise(r => setTimeout(r, 250));
  }

  // Filter out any candles older than exact startTimeMs
  allCandles = allCandles.filter(c => c.openTime >= startTimeMs);

  const outDir = path.join(process.cwd(), '.data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outFile = path.join(outDir, `${symbol}-${interval}.json`);
  fs.writeFileSync(outFile, JSON.stringify(allCandles, null, 2));
  console.log(`✅ Saved ${allCandles.length} total candles to ${outFile}`);
}

async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || 'BTCUSDT';
  const days = parseInt(args[1] || '90', 10);

  const timeframes = ['15m', '1h', '4h'];
  for (const tf of timeframes) {
    await downloadKlines(symbol, tf, days);
  }
}

main().catch(console.error);

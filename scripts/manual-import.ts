import fs from 'fs';
import path from 'path';

/**
 * Manual data importer — supports batch directories.
 * 
 * Usage Option A — Single file:
 *   1. Download from browser
 *   2. Save to .data/manual/BTCUSDT-15m.json
 *   3. Run: npx tsx scripts/manual-import.ts BTCUSDT
 * 
 * Usage Option B — Batch directories:
 *   1. Create .data/manual/batch-{1,2,3,4,5}/ directories
 *   2. Download each batch with different endTime
 *   3. Save to .data/manual/batch-1/BTCUSDT-15m.json, etc.
 *   4. Run: npx tsx scripts/manual-import.ts BTCUSDT
 */

const MANUAL_DIR = path.join(process.cwd(), '.data', 'manual');
const OUT_DIR = path.join(process.cwd(), '.data');

async function main() {
  const symbol = process.argv[2] || 'BTCUSDT';
  const timeframes = ['15m', '1h', '4h'];

  for (const tf of timeframes) {
    const allCandles: any[] = [];

    // 1. Try batch directories first
    const batchDirs = fs.readdirSync(MANUAL_DIR).filter(d => d.startsWith('batch-')).sort();

    for (const dir of batchDirs) {
      const batchFile = path.join(MANUAL_DIR, dir, `${symbol}-${tf}.json`);
      if (fs.existsSync(batchFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(batchFile, 'utf-8'));
          const candles = raw.map((k: any) => ({
            openTime: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            closeTime: k[6],
          }));
          allCandles.push(...candles);
          console.log(`  📦 Batch ${dir}: ${candles.length} candles`);
        } catch (e: any) {
          console.log(`  ⚠️  Failed to read ${dir}: ${e.message}`);
        }
      }
    }

    // 2. Fallback: try single file in manual root
    if (allCandles.length === 0) {
      const singleFile = path.join(MANUAL_DIR, `${symbol}-${tf}.json`);
      if (fs.existsSync(singleFile)) {
        const raw = JSON.parse(fs.readFileSync(singleFile, 'utf-8'));
        const candles = raw.map((k: any) => ({
          openTime: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          closeTime: k[6],
        }));
        allCandles.push(...candles);
        console.log(`  📄 Single file: ${candles.length} candles`);
      }
    }

    if (allCandles.length === 0) {
      console.log(`⏭️  Skip ${symbol}-${tf} — no data found`);
      console.log(`   Place batch files in .data/manual/batch-{N}/${symbol}-${tf}.json`);
      continue;
    }

    // Deduplicate and sort
    const seen = new Map<number, any>();
    for (const c of allCandles) {
      if (!seen.has(c.openTime) || c.closeTime > seen.get(c.openTime).closeTime) {
        seen.set(c.openTime, c);
      }
    }
    let merged = Array.from(seen.values()).sort((a, b) => a.openTime - b.openTime);

    // Merge with existing data if any
    const outFile = path.join(OUT_DIR, `${symbol}-${tf}.json`);
    if (fs.existsSync(outFile)) {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
      for (const c of existing) {
        if (!seen.has(c.openTime)) {
          merged.push(c);
        }
      }
      merged.sort((a: any, b: any) => a.openTime - b.openTime);
    }

    fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));
    const firstDate = new Date(merged[0].openTime).toLocaleDateString('id-ID');
    const lastDate = new Date(merged[merged.length - 1].openTime).toLocaleDateString('id-ID');
    const days = ((merged[merged.length - 1].openTime - merged[0].openTime) / (1000 * 60 * 60 * 24)).toFixed(0);
    console.log(`✅ ${symbol}-${tf}: ${merged.length} candles (${firstDate} → ${lastDate}, ${days} days)`);
  }
}

main().catch(console.error);

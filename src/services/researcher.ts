import { GoogleGenerativeAI } from '@google/generative-ai';
import { MTFAnalysisResult, ResearchResult } from '../types';
import {
  GEMINI_MODEL,
  MIN_AI_CONFIDENCE,
  TF_LABELS,
} from '../config/constants';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Build prompt for AI researcher based on technical analysis results.
 */
function buildResearchPrompt(analysis: MTFAnalysisResult): string {
  const { symbol, analyses, agreement } = analysis;
  const dir = agreement.direction;

  const tfSummaries = Object.entries(analyses)
    .map(([tf, a]) => {
      const label = TF_LABELS[tf as keyof typeof TF_LABELS];
      const { ema, rsi, volume, pattern, regime } = a.indicators;
      const patStr = pattern.detected ? ` | Pat: ${pattern.detected}` : '';
      return `- ${label}: ${a.direction} | EMA9=${ema.ema9.toFixed(2)}, EMA21=${ema.ema21.toFixed(2)} | RSI=${rsi.value} (${rsi.condition}) | ADX=${regime.value} (Trending: ${regime.isTrending}) | Vol Confirmed: ${volume.isConfirmed}${patStr}`;
    })
    .join('\n');

  return `You are a crypto market research analyst. Analyze the following trading signal and provide your assessment.

## Symbol: ${symbol}
## Signal Direction: ${dir}
## Timeframe Agreement: ${agreement.strength}

### Technical Analysis Summary:
${tfSummaries}

## Your Task:
1. Based on your knowledge of ${symbol.replace('USDT', '')} and current crypto market conditions, assess whether this ${dir} signal makes sense.
2. Consider recent major news, events, or catalysts that could affect this trade.
3. Identify any risks or counter-arguments against this signal.
4. Provide a confidence score from 0-100 (where 100 = extremely confident the signal is correct).

## Response Format (JSON only, no markdown):
{
  "confidence": <number 0-100>,
  "sentiment": "<BULLISH|BEARISH|NEUTRAL>",
  "reasoning": "<2-3 sentences explaining your assessment in Bahasa Indonesia>",
  "shouldProceed": <true|false>
}`;
}

/**
 * Call Gemini AI to analyze and validate the trading signal.
 * Only called when technical indicators already align.
 */
export async function researchSignal(
  analysis: MTFAnalysisResult,
): Promise<ResearchResult> {
  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      tools: [{ googleSearch: {} } as any],
    });

    const prompt = buildResearchPrompt(analysis);

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text().trim();

    // Parse JSON response — handle potential markdown wrapping
    let jsonStr = text;
    if (text.includes('```')) {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    return {
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
      sentiment: parsed.sentiment || 'NEUTRAL',
      reasoning: parsed.reasoning || 'No reasoning provided.',
      shouldProceed:
        parsed.confidence >= MIN_AI_CONFIDENCE &&
        parsed.shouldProceed !== false,
    };
  } catch (error: any) {
    console.error(`AI Research error for ${analysis.symbol}:`, error.message);

    // On AI failure, default to proceed (don't block signals due to AI errors)
    return {
      confidence: 50,
      sentiment: 'NEUTRAL',
      reasoning: `AI analysis unavailable: ${error.message}. Proceeding with technical signal only.`,
      shouldProceed: true,
    };
  }
}

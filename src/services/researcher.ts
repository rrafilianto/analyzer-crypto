import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { MTFAnalysisResult, ResearchResult } from '../types';
import {
  GEMINI_MODEL,
  MIN_AI_CONFIDENCE,
  TF_LABELS,
  AI_FALLBACK_STRATEGY,
  AI_MAX_RETRIES,
  AI_TIMEOUT_MS,
} from '../config/constants';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ========================
// Retry & Timeout Helpers
// ========================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Gemini with timeout + exponential backoff retry.
 * Retries only on 5xx errors and network failures.
 */
async function generateWithRetry(
  model: GenerativeModel,
  prompt: string,
  maxRetries: number,
  timeoutMs: number
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resultPromise = model.generateContent(prompt);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      );

      const result = await Promise.race([resultPromise, timeoutPromise]);
      const response = result.response;
      const text = response.text().trim();

      if (!text || text.length === 0) {
        throw new Error('Empty response from Gemini API');
      }

      return text;
    } catch (error: any) {
      lastError = error;

      // Don't retry on 4xx client errors
      const isClientError = error.message?.includes('400') || error.message?.includes('401') || error.message?.includes('403') || error.message?.includes('404');
      if (isClientError) {
        throw error;
      }

      console.warn(`[AI] Gemini attempt ${attempt}/${maxRetries} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt - 1);
        console.log(`[AI] Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Gemini API call failed after ${maxRetries} attempts: ${lastError?.message ?? 'unknown error'}`
  );
}

// ========================
// Prompt Builder
// ========================

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

// ========================
// Fallback Strategy
// ========================

/**
 * Build fallback result based on configured strategy.
 */
function buildFallbackResult(error: Error): ResearchResult {
  switch (AI_FALLBACK_STRATEGY) {
    case 'strict':
      return {
        confidence: 0,
        sentiment: 'NEUTRAL',
        reasoning: `AI unavailable: ${error.message}. Signal skipped.`,
        shouldProceed: false,
      };

    case 'moderate':
      return {
        confidence: 40,
        sentiment: 'NEUTRAL',
        reasoning: `AI unavailable: ${error.message}. Proceeding with caution based on technical signals only.`,
        shouldProceed: true,
      };

    case 'lenient':
    default:
      return {
        confidence: 50,
        sentiment: 'NEUTRAL',
        reasoning: `AI analysis unavailable: ${error.message}. Proceeding with technical signal only.`,
        shouldProceed: true,
      };
  }
}

// ========================
// Main Research Function
// ========================

/**
 * Call Gemini AI to analyze and validate the trading signal.
 * Retries on 5xx/network errors, falls back to configured strategy if all attempts fail.
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
    const text = await generateWithRetry(model, prompt, AI_MAX_RETRIES, AI_TIMEOUT_MS);

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
    return buildFallbackResult(error);
  }
}

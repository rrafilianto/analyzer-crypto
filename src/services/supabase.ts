import { createClient } from '@supabase/supabase-js';
import { TradeSignal } from '../types';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

export const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

export interface DBTrade {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  tp1: number;
  tp2: number;
  sl: number;
  status: 'OPEN' | 'TP1_HIT' | 'CLOSED_WIN' | 'CLOSED_LOSS' | 'CLOSED_BE';
  tp1_hit: boolean;
  pnl_percent: number;
  created_at: string;
  updated_at: string;
}

export async function insertNewTrade(signal: TradeSignal) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('trades').insert([{
    symbol: signal.symbol,
    direction: signal.direction,
    entry_price: signal.entry,
    tp1: signal.takeProfit1,
    tp2: signal.takeProfit2,
    sl: signal.stopLoss,
    status: 'OPEN',
    tp1_hit: false,
    pnl_percent: 0
  }]).select().single();

  if (error) console.error('Supabase Insert Error:', error);
  return data;
}

export async function getOpenTrades(symbol?: string): Promise<DBTrade[]> {
  if (!supabase) return [];
  let query = supabase.from('trades').select('*').in('status', ['OPEN', 'TP1_HIT']);
  if (symbol) query = query.eq('symbol', symbol);

  const { data, error } = await query;
  if (error) {
    console.error('Supabase Select Error:', error);
    return [];
  }
  return data as DBTrade[];
}

export async function updateTradeStatus(
  id: string,
  updates: Partial<Pick<DBTrade, 'status' | 'tp1_hit' | 'pnl_percent' | 'sl'>>
) {
  if (!supabase) return;
  const { error } = await supabase
    .from('trades')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) console.error('Supabase Update Error:', error);
}

/**
 * Check if a signal for the same symbol + direction was recently sent
 * within the cooldown window (prevents duplicate signals).
 */
export async function checkRecentSignal(
  symbol: string,
  direction: 'LONG' | 'SHORT',
  cooldownMinutes: number = 60
): Promise<boolean> {
  if (!supabase) return false;

  const cooldownAgo = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('trades')
    .select('id, symbol, direction, created_at')
    .eq('symbol', symbol)
    .eq('direction', direction)
    .gte('created_at', cooldownAgo)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Supabase Recent Signal Check Error:', error);
    return false; // On error, allow signal (don't block due to DB issues)
  }

  return data !== null && data.length > 0;
}

/**
 * Fetch all closed trades for PnL reporting.
 */
export async function getClosedTrades(limit: number = 50): Promise<DBTrade[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .in('status', ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_BE'])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Supabase Closed Trades Fetch Error:', error);
    return [];
  }
  return data as DBTrade[];
}

/**
 * Get trade statistics summary.
 */
export async function getTradeStats(): Promise<{
  totalTrades: number;
  wins: number;
  losses: number;
  breakEvens: number;
  winRate: string;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  recentTrades: DBTrade[];
} | null> {
  if (!supabase) return null;

  const closedTrades = await getClosedTrades(100);

  if (closedTrades.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, breakEvens: 0,
      winRate: '0.00', totalPnl: 0, avgWin: 0, avgLoss: 0,
      bestTrade: 0, worstTrade: 0, recentTrades: [],
    };
  }

  const wins = closedTrades.filter(t => t.status === 'CLOSED_WIN');
  const losses = closedTrades.filter(t => t.status === 'CLOSED_LOSS');
  const breakEvens = closedTrades.filter(t => t.status === 'CLOSED_BE');

  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl_percent || 0), 0);
  const winPnls = wins.map(t => t.pnl_percent || 0);
  const lossPnls = losses.map(t => t.pnl_percent || 0);

  return {
    totalTrades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    breakEvens: breakEvens.length,
    winRate: closedTrades.length > 0
      ? (((wins.length + breakEvens.length) / closedTrades.length) * 100).toFixed(2)
      : '0.00',
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgWin: winPnls.length > 0 ? Math.round((winPnls.reduce((a, b) => a + b, 0) / winPnls.length) * 100) / 100 : 0,
    avgLoss: lossPnls.length > 0 ? Math.round((lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length) * 100) / 100 : 0,
    bestTrade: winPnls.length > 0 ? Math.round(Math.max(...winPnls) * 100) / 100 : 0,
    worstTrade: lossPnls.length > 0 ? Math.round(Math.min(...lossPnls) * 100) / 100 : 0,
    recentTrades: closedTrades.slice(0, 10),
  };
}

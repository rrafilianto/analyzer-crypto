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

import { getBalance, getFills, getPositions } from "../kalshi";

export interface DashboardPosition {
  ticker: string;
  position: number;
  exposure: number;
  realizedPnl: number;
  feesPaid: number;
  totalTraded: number;
  restingOrders: number;
  lastUpdated: string | null;
}

export interface DashboardData {
  timestamp: string;
  account: {
    cash: number;
    portfolioValue: number;
    equity: number;
  };
  pnl: {
    realized: number;
    fees: number;
    net: number;
    returnPct: number;
  };
  positions: {
    count: number;
    activeCount: number;
    totalExposure: number;
    largest: DashboardPosition | null;
    rows: DashboardPosition[];
  };
  edge: {
    wins: number;
    losses: number;
    flat: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    expectancy: number;
    recentFillCount: number;
  };
  risk: {
    exposureRatio: number;
    concentrationRatio: number;
    openRisk: number;
    restingOrders: number;
  };
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function centsToDollars(value: unknown): number {
  return asNumber(value) / 100;
}

export async function getDashboardData(): Promise<DashboardData> {
  const [balanceResponse, positionsResponse, fillsResponse] = await Promise.all([
    getBalance(),
    getPositions(),
    getFills({ limit: 500 }),
  ]);

  const balance = balanceResponse as unknown as Record<string, unknown>;
  const cash = asNumber(balance.balance_dollars) || centsToDollars(balance.balance);
  const portfolioValue = centsToDollars(balance.portfolio_value);
  const equity = cash + portfolioValue;

  const positionPayload = positionsResponse as unknown as {
    market_positions?: Array<Record<string, unknown>>;
  };
  const rows = (positionPayload.market_positions ?? [])
    .map((position): DashboardPosition => ({
      ticker: asString(position.ticker) ?? "UNKNOWN",
      position: asNumber(position.position_fp),
      exposure: asNumber(position.market_exposure_dollars),
      realizedPnl: asNumber(position.realized_pnl_dollars),
      feesPaid: asNumber(position.fees_paid_dollars),
      totalTraded: asNumber(position.total_traded_dollars),
      restingOrders: asNumber(position.resting_orders_count),
      lastUpdated: asString(position.last_updated_ts),
    }))
    .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure));

  const totalExposure = rows.reduce((sum, position) => sum + Math.abs(position.exposure), 0);
  const realized = rows.reduce((sum, position) => sum + position.realizedPnl, 0);
  const fees = rows.reduce((sum, position) => sum + position.feesPaid, 0);
  const net = realized - fees;
  const traded = rows.reduce((sum, position) => sum + position.totalTraded, 0);
  const returnPct = traded > 0 ? net / traded : 0;
  const largest = rows[0] ?? null;

  const closed = rows.filter((position) => position.realizedPnl !== 0);
  const wins = closed.filter((position) => position.realizedPnl > 0).length;
  const losses = closed.filter((position) => position.realizedPnl < 0).length;
  const flat = rows.length - closed.length;
  const avgWin = wins > 0 ? closed.filter((p) => p.realizedPnl > 0).reduce((s, p) => s + p.realizedPnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? Math.abs(closed.filter((p) => p.realizedPnl < 0).reduce((s, p) => s + p.realizedPnl, 0) / losses) : 0;
  const winRate = closed.length > 0 ? wins / closed.length : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  const fillsPayload = fillsResponse as { fills?: unknown[] };
  const restingOrders = rows.reduce((sum, position) => sum + position.restingOrders, 0);

  return {
    timestamp: new Date().toISOString(),
    account: { cash, portfolioValue, equity },
    pnl: { realized, fees, net, returnPct },
    positions: {
      count: rows.length,
      activeCount: rows.filter((position) => position.position !== 0 || position.exposure !== 0).length,
      totalExposure,
      largest,
      rows: rows.slice(0, 30),
    },
    edge: {
      wins,
      losses,
      flat,
      winRate,
      avgWin,
      avgLoss,
      expectancy,
      recentFillCount: Array.isArray(fillsPayload.fills) ? fillsPayload.fills.length : 0,
    },
    risk: {
      exposureRatio: equity > 0 ? totalExposure / equity : 0,
      concentrationRatio: totalExposure > 0 && largest ? Math.abs(largest.exposure) / totalExposure : 0,
      openRisk: totalExposure,
      restingOrders,
    },
  };
}

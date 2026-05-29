import { getBalance, getPositions } from "../kalshi";

export interface RiskSummary {
  totalExposure: number;
  netPnl: number;
  largestPosition: { ticker: string; value: number } | null;
  positionCount: number;
  availableCash: number;
  exposureRatio: number;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function kellySize(opts: {
  prob: number;
  odds: number;
  bankroll: number;
  fraction?: number;
}): number {
  const p = opts.prob;
  const b = opts.odds;
  const bankroll = opts.bankroll;
  const fraction = opts.fraction ?? 0.5;

  if (b <= 0 || bankroll <= 0) return 0;

  const fStar = (p * (b + 1) - 1) / b;
  if (fStar <= 0) return 0;

  return Math.max(0, fStar * fraction * bankroll);
}

export async function getRiskSummary(): Promise<RiskSummary> {
  const [positionsResponse, balanceResponse] = await Promise.all([getPositions(), getBalance()]);

  const positionCandidates = positionsResponse as unknown as {
    market_positions?: Array<Record<string, unknown>>;
    positions?: Array<Record<string, unknown>>;
  };

  const positions =
    positionCandidates.market_positions ?? positionCandidates.positions ?? [];

  const normalized = positions.map((position) => {
    const value =
      asNumber(position.value) ||
      asNumber(position.market_value) ||
      asNumber(position.notional_value) ||
      asNumber(position.cost_basis);

    const pnl =
      asNumber(position.unrealized_pnl) ||
      asNumber(position.pnl) ||
      asNumber(position.realized_pnl);

    const ticker =
      (typeof position.ticker === "string" && position.ticker) ||
      (typeof position.market_ticker === "string" && position.market_ticker) ||
      "UNKNOWN";

    return { ticker, value, pnl };
  });

  const totalExposure = normalized.reduce((sum, position) => sum + position.value, 0);
  const netPnl = normalized.reduce((sum, position) => sum + position.pnl, 0);
  const largest = normalized.reduce<{ ticker: string; value: number } | null>((current, pos) => {
    if (!current || pos.value > current.value) {
      return { ticker: pos.ticker, value: pos.value };
    }
    return current;
  }, null);

  const balance = balanceResponse as unknown as Record<string, unknown>;
  const availableCash =
    asNumber(balance.balance) ||
    asNumber(balance.available_cash) ||
    asNumber(balance.available_balance) ||
    0;

  const denominator = totalExposure + availableCash;
  const exposureRatio = denominator > 0 ? totalExposure / denominator : 0;

  return {
    totalExposure,
    netPnl,
    largestPosition: largest,
    positionCount: normalized.length,
    availableCash,
    exposureRatio,
  };
}

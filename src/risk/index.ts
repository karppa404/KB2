import { getBalance, getAllPositions } from "../kalshi";

export interface RiskSummary {
  /** All monetary values in this summary are US dollars. */
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

  if (![p, b, bankroll, fraction].every(Number.isFinite) || p < 0 || p > 1 || fraction < 0 || fraction > 1 || b < 0 || bankroll < 0) {
    throw new Error("Kelly inputs require probability and fraction in [0, 1], and finite nonnegative odds and bankroll");
  }

  if (b <= 0 || bankroll <= 0) return 0;

  const fStar = (p * (b + 1) - 1) / b;
  if (fStar <= 0) return 0;

  return Math.max(0, fStar * fraction * bankroll);
}

export async function getRiskSummary(): Promise<RiskSummary> {
  const [positionsResponse, balanceResponse] = await Promise.all([getAllPositions(), getBalance()]);

  const positions = positionsResponse.market_positions ?? [];

  const normalized = positions.map((position) => {
    const value = Math.abs(asNumber(position.market_exposure_dollars));
    const pnl = asNumber(position.realized_pnl_dollars) - asNumber(position.fees_paid_dollars);
    const ticker = position.ticker || "UNKNOWN";

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

  const availableCash = balanceResponse.balance_dollars == null
    ? asNumber(balanceResponse.balance) / 100
    : asNumber(balanceResponse.balance_dollars);

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

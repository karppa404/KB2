export type Venue = "kalshi" | "polymarket";
export type Category = "politics" | "economics" | "weather" | "sports" | "technology" | "entertainment";
export interface Market {
  venue: Venue; id: string; title: string; category: Category | "other";
  yesToken?: string; noToken?: string; yesBid: number | null; yesAsk: number | null;
  closesAt?: string; rules: string; tickSize?: string; minSize?: number; negRisk?: boolean;
}
export interface OrderRequest {
  venue: Venue; marketId: string; outcome: "yes" | "no"; action: "buy" | "sell";
  price: number; quantity: number; postOnly: boolean; clientOrderId: string;
  tokenId?: string; expiresAt?: string;
}
export interface OrderResult {
  orderId: string; status: "open" | "filled" | "canceled" | "rejected";
  filledQuantity: number; averagePrice?: number; fees?: number;
}
export interface Position { marketId: string; outcome: "yes" | "no"; quantity: number; }
export interface Exchange {
  venue: Venue;
  discover(categories: Category[], cursor?: string): Promise<{markets: Market[]; cursor?: string}>;
  market(id: string): Promise<Market>;
  place(order: OrderRequest): Promise<OrderResult>;
  cancel(orderId: string): Promise<void>;
  order(orderId: string): Promise<OrderResult>;
  positions(): Promise<Position[]>;
  balance(): Promise<number>;
}
export class ExchangeError extends Error {
  constructor(public code: string, message: string, public uncertain = false) { super(message); }
}

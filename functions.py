import os
from typing import Any, Dict, Optional
import aiohttp
from dotenv import load_dotenv
from kalshi_python_async import Configuration, KalshiClient

load_dotenv()
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY")
KALSHI_API_ID = os.getenv("KALSHI_API_ID")

with open("./bot.pem", "r") as f:
    private_key = f.read()

config = Configuration(host="https://external-api.kalshi.com/trade-api/v2")
config.api_key_id = KALSHI_API_ID
config.private_key_pem = private_key
client = KalshiClient(config)

"""KALSHI COMMANDS"""
async def getbalance():
    balance = await client.get_balance()
    return balance.json()


async def getPositions(
    cursor: Optional[str] = None,
    limit: int = 100,
    count_filter: Optional[str] = None,
    ticker: Optional[str] = None,
    event_ticker: Optional[str] = None,
    subaccount: int = 0,
) -> Dict[str, Any]:
    response = await client.get_positions(
        cursor=cursor,
        limit=limit,
        count_filter=count_filter,
        ticker=ticker,
        event_ticker=event_ticker,
        subaccount=subaccount,
    )
    return response.to_dict()


async def getSettlements(
    limit: int = 100,
    cursor: Optional[str] = None,
    ticker: Optional[str] = None,
    event_ticker: Optional[str] = None,
    min_ts: Optional[int] = None,
    max_ts: Optional[int] = None,
    subaccount: Optional[int] = None,
) -> Dict[str, Any]:
    response = await client.get_settlements(
        limit=limit,
        cursor=cursor,
        ticker=ticker,
        event_ticker=event_ticker,
        min_ts=min_ts,
        max_ts=max_ts,
        subaccount=subaccount,
    )
    return response.to_dict()


async def getMarkets(
    limit: int = 100,
    cursor: Optional[str] = None,
    status: str = "open",
    ticker: Optional[str] = None,
    series_ticker: Optional[str] = None,
) -> Dict[str, Any]:
    """Search for available markets filtered by status or ticker."""
    response = await client.get_markets(
        limit=limit,
        cursor=cursor,
        status=status,
        ticker=ticker,
        series_ticker=series_ticker,
    )
    return response.to_dict()


async def getOrderbook(ticker: str) -> Dict[str, Any]:
    """Get the current order book snapshot (bids/asks) for a specific ticker."""
    response = await client.get_market_orderbook(ticker=ticker)
    return response.to_dict()


async def placeOrder(
    ticker: str,
    action: str,  # "buy" or "sell"
    side: str,  # "yes" or "no"
    count: int,  # Number of contracts
    yes_price: int,  # Price per contract in cents (1-99)
    client_order_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Place a limit order on a specific market contract."""
    response = await client.create_order(
        ticker=ticker,
        action=action,
        side=side,
        count=count,
        yes_price=yes_price,
        client_order_id=client_order_id,
    )
    return response.to_dict()


async def cancelOrder(order_id: str) -> Dict[str, Any]:
    """Cancel an active resting order using its unique order ID."""
    response = await client.cancel_order(order_id=order_id)
    return response.to_dict()


async def getOrders(
    status: Optional[str] = None,  # "resting", "filled", "canceled"
    ticker: Optional[str] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    """Get a list of orders filtered by status or market ticker."""
    response = await client.get_orders(status=status, ticker=ticker, limit=limit)
    return response.to_dict()


async def getMarket(ticker: str) -> Dict[str, Any]:
    """Get detailed metadata for a single specific market contract."""
    response = await client.get_market(ticker=ticker)
    return response.to_dict()


async def getMarketCandlesticks(
    ticker: str,
    series_ticker: str,
    start_ts: Optional[int] = None,  # Unix timestamp
    end_ts: Optional[int] = None,  # Unix timestamp
    period: int = 60,  # Period in minutes (e.g., 1, 60, 1440)
    limit: int = 100,
) -> Dict[str, Any]:
    """Get historical OHLCV candlestick data for a specific market."""
    response = await client.get_market_candlesticks(
        ticker=ticker,
        series_ticker=series_ticker,
        start_ts=start_ts,
        end_ts=end_ts,
        period=period,
        limit=limit,
    )
    return response.to_dict()


async def getTrades(
    ticker: str,
    limit: int = 100,
    cursor: Optional[str] = None,
) -> Dict[str, Any]:
    """Get the public history of executed trades across the entire platform for a market."""
    response = await client.get_trades(
        ticker=ticker,
        limit=limit,
        cursor=cursor,
    )
    return response.to_dict()

async def getFills(
    ticker: Optional[str] = None,
    order_id: Optional[str] = None,
    min_ts: Optional[int] = None,
    max_ts: Optional[int] = None,
    limit: int = 100,
    cursor: Optional[str] = None,
) -> Dict[str, Any]:
    """Get individual fill records for your orders."""
    response = await client.get_fills(
        ticker=ticker,
        order_id=order_id,
        min_ts=min_ts,
        max_ts=max_ts,
        limit=limit,
        cursor=cursor,
    )
    return response.to_dict()

async def getPortfolioHistory(
    limit: int = 100,
    cursor: Optional[str] = None,
    start_ts: Optional[int] = None,
    end_ts: Optional[int] = None,
) -> Dict[str, Any]:
    """Get historical portfolio balance snapshots over time."""
    response = await client.get_portfolio_history(
        limit=limit,
        cursor=cursor,
        start_ts=start_ts,
        end_ts=end_ts,
    )
    return response.to_dict()

async def getEvent(event_ticker: str) -> Dict[str, Any]:
    """Get detailed metadata for a single event (parent of markets)."""
    response = await client.get_event(event_ticker=event_ticker)
    return response.to_dict()

async def getEvents(
    limit: int = 100,
    cursor: Optional[str] = None,
    status: Optional[str] = None,  # "open", "closed", "settled"
    series_ticker: Optional[str] = None,
    with_nested_markets: bool = False,  # include child markets in response
) -> Dict[str, Any]:
    """Search and list events, optionally with their nested markets."""
    response = await client.get_events(
        limit=limit,
        cursor=cursor,
        status=status,
        series_ticker=series_ticker,
        with_nested_markets=with_nested_markets,
    )
    return response.to_dict()

async def amendOrder(
    order_id: str,
    count: Optional[int] = None,  # new quantity; omit to keep unchanged
    yes_price: Optional[int] = None,  # new price in cents; omit to keep unchanged
) -> Dict[str, Any]:
    """Amend the price or quantity of a resting order in place."""
    response = await client.amend_order(
        order_id=order_id,
        count=count,
        yes_price=yes_price,
    )
    return response.to_dict()

async def batchCreateOrders(
    orders: list[
        Dict[str, Any]
    ],  # list of order dicts, each matching placeOrder's params
) -> Dict[str, Any]:
    """Place multiple limit orders in a single API call.
    Each order dict should contain:
        ticker, action, side, count, yes_price, and optionally client_order_id
    """
    response = await client.batch_create_orders(orders=orders)
    return response.to_dict()

async def batchCancelOrders(order_ids: list[str]) -> Dict[str, Any]:
    """Cancel multiple resting orders in a single API call."""
    response = await client.batch_cancel_orders(order_ids=order_ids)
    return response.to_dict()

async def getSeries(series_ticker: str) -> Dict[str, Any]:
    """Get metadata for a series (top of the event/market hierarchy)."""
    response = await client.get_series(series_ticker=series_ticker)
    return response.to_dict()

async def getExchangeStatus() -> Dict[str, Any]:
    """Check whether the exchange is open, halted, or closed.
    Should be called before placing any orders in an automated session.
    """
    response = await client.get_exchange_status()
    return response.to_dict()


"""PERPLEXITY"""
async def searchPerplexity(
    query: str,
    recency: str = "month",
    model: str = "sonar",
    system_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """Search for up-to-date information via Perplexity. Model options:
    - sonar:                fast, cheap, good for quick fact checks
    - sonar-pro:            balanced, more citations (default)
    - sonar-reasoning-pro:  chain-of-thought, good for probability reasoning
    - sonar-deep-research:  multi-step deep research, most expensive
    """
    default_system = (
        "You are a research assistant helping analyze prediction markets. "
        "Give concise, factual, up-to-date information with specific numbers, "
        "dates, and sources where possible. Focus on information relevant to "
        "assessing the probability of the event outcome."
    )

    async with aiohttp.ClientSession() as session:
        async with session.post(
            "https://api.perplexity.ai/chat/completions",
            headers={
                "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt or default_system,
                    },
                    {"role": "user", "content": query},
                ],
                "search_recency_filter": recency,
                "return_citations": True,
            },
        ) as resp:
            data = await resp.json()

            # sonar-reasoning-pro returns a <think>...</think> block
            # in the content — split it out so it's readable separately
            content = data["choices"][0]["message"]["content"]
            thinking, answer = None, content
            if "<think>" in content and "</think>" in content:
                think_start = content.index("<think>") + len("<think>")
                think_end = content.index("</think>")
                thinking = content[think_start:think_end].strip()
                answer = content[think_end + len("</think>"):].strip()

            return {
                "answer": answer,
                "thinking": thinking,        # None for non-reasoning models
                "citations": data.get("citations", []),
                "model": data.get("model"),
                "usage": data.get("usage"),
            }

async def getRiskSummary() -> Dict[str, Any]:
    """Compute a simple risk snapshot from balance + open positions.
    Call this before placing any order."""
    balance_raw = await client.get_balance()
    positions_raw = await client.get_positions(limit=100)
    
    balance = balance_raw.json()
    positions = positions_raw.to_dict()

    available = balance.get("balance", 0)  # cents
    
    open_positions = [
        p for p in positions.get("market_positions", [])
        if p.get("position", 0) != 0
    ]

    total_exposure = sum(
        abs(p.get("position", 0)) * p.get("market_exposure", 100)
        for p in open_positions
    )

    return {
        "available_balance_cents": available,
        "available_balance_dollars": round(available / 100, 2),
        "open_position_count": len(open_positions),
        "total_exposure_cents": total_exposure,
        "total_exposure_dollars": round(total_exposure / 100, 2),
        "exposure_pct_of_balance": round(total_exposure / available * 100, 2) if available else 0,
        "positions": open_positions,
    }


def kellySize(
    prob: float,       # your estimated probability (0-1)
    yes_price: int,    # kalshi price in cents (1-99)
    balance: int,      # available balance in cents
    fraction: float = 0.25,  # fractional kelly — 0.25 is conservative
    max_pct: float = 0.10,   # hard cap: never risk more than this % of balance
) -> Dict[str, Any]:
    """Calculate Kelly-optimal contract count for a given edge.
    
    fraction=0.25 means quarter-Kelly which is standard for uncertain edges.
    max_pct=0.10 hard caps at 10% of balance regardless of Kelly output.
    """
    p = prob
    q = 1 - p
    b = (100 - yes_price) / yes_price  # payout ratio (win/loss)

    kelly_fraction = (p * b - q) / b  # standard Kelly formula
    
    if kelly_fraction <= 0:
        return {
            "contracts": 0,
            "reason": "No edge — Kelly fraction is negative",
            "kelly_fraction": round(kelly_fraction, 4),
        }

    fractional_kelly = kelly_fraction * fraction
    capped_kelly = min(fractional_kelly, max_pct)

    dollar_risk = balance * capped_kelly
    contracts = int(dollar_risk / yes_price)  # yes_price is cost per contract in cents

    return {
        "contracts": max(0, contracts),
        "kelly_fraction": round(kelly_fraction, 4),
        "fractional_kelly": round(fractional_kelly, 4),
        "capped_at_max_pct": fractional_kelly > max_pct,
        "dollar_risk_cents": round(dollar_risk, 2),
        "dollar_risk_dollars": round(dollar_risk / 100, 2),
    }
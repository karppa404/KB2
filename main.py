import argparse
import asyncio
import json
from typing import Any, Dict, Optional

from functions import *


def print_result(result):
    """Pretty-print results as JSON."""
    print(json.dumps(result, indent=2, default=str))


def main():
    parser = argparse.ArgumentParser(
        description="Kalshi Trading CLI Platform for LLM Agents"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # ---- BALANCE ----
    subparsers.add_parser("get-balance", help="Get account balance")

    # ---- MARKETS ----
    markets_parser = subparsers.add_parser(
        "get-markets", help="Search/list available markets"
    )
    markets_parser.add_argument("--limit", type=int, default=100)
    markets_parser.add_argument(
        "--status",
        default="open",
        choices=["open", "closed", "settled"],
        help="Market status filter",
    )
    markets_parser.add_argument("--ticker", help="Filter by ticker")
    markets_parser.add_argument("--series-ticker", help="Filter by series ticker")
    markets_parser.add_argument("--cursor", help="Pagination cursor")

    # ---- MARKET (single) ----
    market_parser = subparsers.add_parser(
        "get-market", help="Get a single market's details"
    )
    market_parser.add_argument(
        "--ticker", required=True, help="Market ticker (e.g., FED-26-B)"
    )

    # ---- ORDERBOOK ----
    orderbook_parser = subparsers.add_parser(
        "get-orderbook", help="Get the current order book for a market"
    )
    orderbook_parser.add_argument("--ticker", required=True)

    # ---- CANDLESTICKS ----
    candles_parser = subparsers.add_parser(
        "get-candles", help="Get market historical candlesticks"
    )
    candles_parser.add_argument("--ticker", required=True)
    candles_parser.add_argument("--series-ticker", required=True)
    candles_parser.add_argument("--start-ts", type=int, help="Start Unix timestamp")
    candles_parser.add_argument("--end-ts", type=int, help="End Unix timestamp")
    candles_parser.add_argument(
        "--period",
        type=int,
        default=60,
        help="Candle period in minutes (e.g. 1, 60, 1440)",
    )
    candles_parser.add_argument("--limit", type=int, default=100)

    # ---- TRADES ----
    trades_parser = subparsers.add_parser(
        "get-trades", help="Get public trade history for a market"
    )
    trades_parser.add_argument("--ticker", required=True)
    trades_parser.add_argument("--limit", type=int, default=100)
    trades_parser.add_argument("--cursor", help="Pagination cursor")

    # ---- POSITIONS ----
    positions_parser = subparsers.add_parser(
        "get-positions", help="Get your current positions"
    )
    positions_parser.add_argument("--ticker", help="Filter by market ticker")
    positions_parser.add_argument("--event-ticker", help="Filter by event ticker")
    positions_parser.add_argument("--limit", type=int, default=100)
    positions_parser.add_argument("--cursor", help="Pagination cursor")
    positions_parser.add_argument("--count-filter", help="Count filter")

    # ---- SETTLEMENTS ----
    settlements_parser = subparsers.add_parser(
        "get-settlements", help="Get your settlement history"
    )
    settlements_parser.add_argument("--ticker", help="Filter by market ticker")
    settlements_parser.add_argument("--event-ticker", help="Filter by event ticker")
    settlements_parser.add_argument("--limit", type=int, default=100)
    settlements_parser.add_argument("--cursor", help="Pagination cursor")
    settlements_parser.add_argument("--min-ts", type=int, help="Min Unix timestamp")
    settlements_parser.add_argument("--max-ts", type=int, help="Max Unix timestamp")

    # ---- ORDERS (list) ----
    orders_parser = subparsers.add_parser("get-orders", help="Get your order history")
    orders_parser.add_argument(
        "--status",
        choices=["resting", "filled", "canceled"],
        help="Filter by order status",
    )
    orders_parser.add_argument("--ticker", help="Filter by market ticker")
    orders_parser.add_argument("--limit", type=int, default=100)

    # ---- PLACE ORDER ----
    place_parser = subparsers.add_parser("place-order", help="Place a limit order")
    place_parser.add_argument("--ticker", required=True, help="Market ticker")
    place_parser.add_argument("--action", required=True, choices=["buy", "sell"])
    place_parser.add_argument("--side", required=True, choices=["yes", "no"])
    place_parser.add_argument(
        "--count", required=True, type=int, help="Number of contracts"
    )
    place_parser.add_argument(
        "--yes-price", required=True, type=int, help="Price in cents (1–99)"
    )
    place_parser.add_argument("--client-order-id", help="Optional idempotency key")

    # ---- CANCEL ORDER ----
    cancel_parser = subparsers.add_parser("cancel-order", help="Cancel a resting order")
    cancel_parser.add_argument("--order-id", required=True, help="Order ID to cancel")
    # ---- FILLS ----
    fills_parser = subparsers.add_parser(
        "get-fills", help="Get individual fill records for your orders"
    )
    fills_parser.add_argument("--ticker", help="Filter by market ticker")
    fills_parser.add_argument("--order-id", help="Filter by order ID")
    fills_parser.add_argument("--min-ts", type=int, help="Min Unix timestamp")
    fills_parser.add_argument("--max-ts", type=int, help="Max Unix timestamp")
    fills_parser.add_argument("--limit", type=int, default=100)
    fills_parser.add_argument("--cursor", help="Pagination cursor")

    # ---- PORTFOLIO HISTORY ----
    portfolio_parser = subparsers.add_parser(
        "get-portfolio-history", help="Get historical portfolio balance snapshots"
    )
    portfolio_parser.add_argument("--limit", type=int, default=100)
    portfolio_parser.add_argument("--cursor", help="Pagination cursor")
    portfolio_parser.add_argument("--start-ts", type=int, help="Start Unix timestamp")
    portfolio_parser.add_argument("--end-ts", type=int, help="End Unix timestamp")

    # ---- EVENT (single) ----
    event_parser = subparsers.add_parser(
        "get-event", help="Get metadata for a single event"
    )
    event_parser.add_argument(
        "--event-ticker", required=True, help="Event ticker (e.g. FED-26)"
    )

    # ---- EVENTS (list) ----
    events_parser = subparsers.add_parser("get-events", help="Search and list events")
    events_parser.add_argument("--limit", type=int, default=100)
    events_parser.add_argument("--cursor", help="Pagination cursor")
    events_parser.add_argument(
        "--status", choices=["open", "closed", "settled"], help="Filter by status"
    )
    events_parser.add_argument("--series-ticker", help="Filter by series ticker")
    events_parser.add_argument(
        "--with-nested-markets",
        action="store_true",
        help="Include child markets in response",
    )

    # ---- AMEND ORDER ----
    amend_parser = subparsers.add_parser(
        "amend-order", help="Amend the price or quantity of a resting order"
    )
    amend_parser.add_argument("--order-id", required=True, help="Order ID to amend")
    amend_parser.add_argument(
        "--count", type=int, help="New quantity (omit to keep unchanged)"
    )
    amend_parser.add_argument(
        "--yes-price", type=int, help="New price in cents 1-99 (omit to keep unchanged)"
    )

    # ---- BATCH CREATE ORDERS ----
    batch_create_parser = subparsers.add_parser(
        "batch-create-orders", help="Place multiple limit orders in one call"
    )
    batch_create_parser.add_argument(
        "--orders",
        required=True,
        help='JSON array of order objects e.g. \'[{"ticker":"X","action":"buy","side":"yes","count":1,"yes_price":55}]\'',
    )

    # ---- BATCH CANCEL ORDERS ----
    batch_cancel_parser = subparsers.add_parser(
        "batch-cancel-orders", help="Cancel multiple resting orders in one call"
    )
    batch_cancel_parser.add_argument(
        "--order-ids",
        required=True,
        help='Comma-separated list of order IDs to cancel e.g. "id1,id2,id3"',
    )

    # ---- SERIES ----
    series_parser = subparsers.add_parser(
        "get-series", help="Get metadata for a series (top of the hierarchy)"
    )
    series_parser.add_argument(
        "--series-ticker", required=True, help="Series ticker (e.g. FED)"
    )

    # ---- EXCHANGE STATUS ----
    subparsers.add_parser(
        "get-exchange-status", help="Check if the exchange is open, halted, or closed"
    )
    # ---- PARSE ----
    args = parser.parse_args()

    # ---- DISPATCH ----
    if args.command == "get-balance":
        result = asyncio.run(getbalance())
        print_result(result)

    elif args.command == "get-markets":
        result = asyncio.run(
            getMarkets(
                limit=args.limit,
                cursor=args.cursor,
                status=args.status,
                ticker=args.ticker,
                series_ticker=args.series_ticker,
            )
        )
        print_result(result)

    elif args.command == "get-market":
        result = asyncio.run(getMarket(ticker=args.ticker))
        print_result(result)

    elif args.command == "get-orderbook":
        result = asyncio.run(getOrderbook(ticker=args.ticker))
        print_result(result)

    elif args.command == "get-candles":
        result = asyncio.run(
            getMarketCandlesticks(
                ticker=args.ticker,
                series_ticker=args.series_ticker,
                start_ts=args.start_ts,
                end_ts=args.end_ts,
                period=args.period,
                limit=args.limit,
            )
        )
        print_result(result)

    elif args.command == "get-trades":
        result = asyncio.run(
            getTrades(
                ticker=args.ticker,
                limit=args.limit,
                cursor=args.cursor,
            )
        )
        print_result(result)

    elif args.command == "get-positions":
        result = asyncio.run(
            getPositions(
                cursor=args.cursor,
                limit=args.limit,
                count_filter=args.count_filter,
                ticker=args.ticker,
                event_ticker=args.event_ticker,
            )
        )
        print_result(result)

    elif args.command == "get-settlements":
        result = asyncio.run(
            getSettlements(
                limit=args.limit,
                cursor=args.cursor,
                ticker=args.ticker,
                event_ticker=args.event_ticker,
                min_ts=args.min_ts,
                max_ts=args.max_ts,
            )
        )
        print_result(result)

    elif args.command == "get-orders":
        result = asyncio.run(
            getOrders(
                status=args.status,
                ticker=args.ticker,
                limit=args.limit,
            )
        )
        print_result(result)

    elif args.command == "place-order":
        result = asyncio.run(
            placeOrder(
                ticker=args.ticker,
                action=args.action,
                side=args.side,
                count=args.count,
                yes_price=args.yes_price,
                client_order_id=args.client_order_id,
            )
        )
        print_result(result)

    elif args.command == "cancel-order":
        result = asyncio.run(cancelOrder(order_id=args.order_id))
        print_result(result)
    elif args.command == "get-fills":
        result = asyncio.run(
            getFills(
                ticker=args.ticker,
                order_id=args.order_id,
                min_ts=args.min_ts,
                max_ts=args.max_ts,
                limit=args.limit,
                cursor=args.cursor,
            )
        )
        print_result(result)

    elif args.command == "get-portfolio-history":
        result = asyncio.run(
            getPortfolioHistory(
                limit=args.limit,
                cursor=args.cursor,
                start_ts=args.start_ts,
                end_ts=args.end_ts,
            )
        )
        print_result(result)

    elif args.command == "get-event":
        result = asyncio.run(getEvent(event_ticker=args.event_ticker))
        print_result(result)

    elif args.command == "get-events":
        result = asyncio.run(
            getEvents(
                limit=args.limit,
                cursor=args.cursor,
                status=args.status,
                series_ticker=args.series_ticker,
                with_nested_markets=args.with_nested_markets,
            )
        )
        print_result(result)

    elif args.command == "amend-order":
        result = asyncio.run(
            amendOrder(
                order_id=args.order_id,
                count=args.count,
                yes_price=args.yes_price,
            )
        )
        print_result(result)

    elif args.command == "batch-create-orders":
        orders = json.loads(args.orders)
        result = asyncio.run(batchCreateOrders(orders=orders))
        print_result(result)

    elif args.command == "batch-cancel-orders":
        order_ids = [oid.strip() for oid in args.order_ids.split(",")]
        result = asyncio.run(batchCancelOrders(order_ids=order_ids))
        print_result(result)

    elif args.command == "get-series":
        result = asyncio.run(getSeries(series_ticker=args.series_ticker))
        print_result(result)

    elif args.command == "get-exchange-status":
        result = asyncio.run(getExchangeStatus())
        print_result(result)


if __name__ == "__main__":
    main()

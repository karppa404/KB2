import argparse
import os
import asyncio
from dotenv import load_dotenv
from kalshi_python_async import Configuration, KalshiClient

# env set up
load_dotenv()
OPEN_AI_API = os.getenv("OPENAI_API_KEY")
KALSHI_API_ID = os.getenv("KALSHI_API_ID")
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY")

# kalshi python setup
with open("./bot.pem", "r") as f:
    private_key = f.read()

config = Configuration(host="https://api.elections.kalshi.com/trade-api/v2")
config.api_key_id = KALSHI_API_ID
config.private_key_pem = private_key
client = KalshiClient(config)

async def main():
    balance = await client.get_balance()
    print(f"Balance: ${balance.balance / 100:.2f}")

asyncio.run(main())
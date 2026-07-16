"""Crypto Radar Assistant web uygulaması.

Uygulama BtcTurk'ün herkese açık piyasa verilerini okur. Gerçek borsa emri
göndermez; portföy işlemleri ilk sürümde tarayıcıda sanal olarak tutulur.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from threading import RLock
from typing import Any

import ccxt
from flask import Flask, jsonify, render_template


app = Flask(__name__)
app.json.ensure_ascii = False

exchange = ccxt.btcturk({
    "enableRateLimit": True,
    "timeout": 15_000,
})

MARKET_LIMIT = 5
CACHE_SECONDS = 12
_cache: dict[str, Any] = {"created_at": 0.0, "payload": None}
_cache_lock = RLock()


@app.get("/")
def home():
    """Ana uygulama ekranı."""
    return render_template("index.html")


def calculate_change(ticker: dict[str, Any], last_price: float) -> float:
    """BtcTurk verisindeki 24 saatlik değişimi güvenle hesapla."""
    percentage = ticker.get("percentage")
    if percentage is not None:
        return float(percentage)

    opening_price = ticker.get("open")
    if opening_price:
        return (last_price - float(opening_price)) / float(opening_price) * 100

    return 0.0


def format_price(price: float) -> str:
    """Fiyatı TRY için uygun ondalık hassasiyetle döndür."""
    if price >= 100:
        decimals = 2
    elif price >= 1:
        decimals = 4
    else:
        decimals = 8
    return f"{price:,.{decimals}f} ₺"


def fetch_market_payload() -> dict[str, Any]:
    """BtcTurk TRY piyasalarını ve dashboard verisini hazırla."""
    tickers = exchange.fetch_tickers()
    markets: list[dict[str, Any]] = []

    for symbol, ticker in tickers.items():
        if not symbol.endswith("/TRY"):
            continue

        last_price = ticker.get("last")
        if last_price is None:
            continue

        price = float(last_price)
        change = calculate_change(ticker, price)
        markets.append({
            "symbol": symbol,
            "price": price,
            "formatted_price": format_price(price),
            "change": round(change, 2),
            "volume": float(ticker.get("quoteVolume") or 0),
        })

    gainers = sorted(markets, key=lambda item: item["change"], reverse=True)[:MARKET_LIMIT]
    losers = sorted(markets, key=lambda item: item["change"])[:MARKET_LIMIT]

    return {
        "status": "success",
        "source": "BtcTurk",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "market_count": len(markets),
        "gainers": gainers,
        "losers": losers,
        # Açık pozisyonların radar listesinden düşse bile canlı fiyatlarını
        # hesaplayabilmesi için tüm TRY pariteleri gönderilir.
        "prices": {item["symbol"]: item["price"] for item in markets},
    }


@app.get("/api/dashboard")
def dashboard_data():
    """Arayüzün çağırdığı canlı piyasa verisi."""
    now = time.monotonic()

    with _cache_lock:
        cached = _cache["payload"]
        if cached and now - _cache["created_at"] < CACHE_SECONDS:
            return jsonify(cached)

    try:
        payload = fetch_market_payload()
        with _cache_lock:
            _cache["created_at"] = now
            _cache["payload"] = payload
        return jsonify(payload)
    except ccxt.BaseError:
        app.logger.exception("BtcTurk piyasa verisi alınamadı")
        return jsonify({
            "status": "error",
            "message": "BtcTurk verisine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.",
        }), 503
    except Exception:
        app.logger.exception("Dashboard verisi hazırlanamadı")
        return jsonify({
            "status": "error",
            "message": "Piyasa verisi hazırlanırken beklenmeyen bir hata oluştu.",
        }), 500


@app.get("/api/health")
def health():
    """Render gibi servisler için uygulama durum uç noktası."""
    return jsonify({"status": "online", "mode": "paper-trading", "source": "BtcTurk"})


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"status": "error", "message": "Sayfa bulunamadı."}), 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "10000")), debug=False)

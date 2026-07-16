"use strict";

const API_URL = "/api/dashboard";
const REFRESH_INTERVAL = 15_000;
const POSITIONS_KEY = "crypto-radar-assistant:positions";
const HISTORY_KEY = "crypto-radar-assistant:history";

const state = {
    prices: new Map(),
    markets: [],
    selectedMarket: null,
    positions: readStorage(POSITIONS_KEY),
    history: readStorage(HISTORY_KEY),
};

const money = new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
});

const $ = (id) => document.getElementById(id);

function readStorage(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return Array.isArray(value) ? value : [];
    } catch (_error) {
        return [];
    }
}

function saveStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function formatPercent(value) {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatNumber(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 8 }).format(value);
}

function makeElement(tag, text = "", className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
}

function setConnection(text, stateClass = "") {
    $("connectionText").textContent = text;
    $("connectionDot").className = `connection-dot ${stateClass}`;
}

function showToast(message, isError = false) {
    const toast = $("toast");
    toast.textContent = message;
    toast.className = isError ? "toast show error" : "toast show";
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => { toast.className = "toast"; }, 3500);
}

function currentPrice(position) {
    return state.prices.get(position.symbol) ?? position.buyPrice;
}

function getRecommendation(position) {
    const price = currentPrice(position);
    if (price >= position.targetPrice) {
        return { text: "Kârı al", className: "take-profit", progressClass: "" };
    }
    if (price <= position.stopPrice * 1.02) {
        return { text: "Stop seviyesine yaklaşıyor", className: "stop-warning", progressClass: "warning" };
    }
    return { text: "Bekle", className: "hold", progressClass: "" };
}

function getProgress(position) {
    const range = position.targetPrice - position.buyPrice;
    if (range <= 0) return 0;
    return Math.max(0, Math.min(100, ((currentPrice(position) - position.buyPrice) / range) * 100));
}

function renderMarketList(containerId, markets) {
    const container = $(containerId);
    container.replaceChildren();

    if (!markets.length) {
        container.append(makeElement("p", "Piyasa verisi bulunamadı.", "loading-text"));
        return;
    }

    markets.forEach((market) => {
        const row = document.createElement("div");
        row.className = "market-item";
        row.append(makeElement("span", market.symbol, "market-symbol"));
        row.append(makeElement("span", market.formatted_price, "market-price"));
        row.append(makeElement("span", formatPercent(market.change), `market-change ${market.change >= 0 ? "positive" : "negative"}`));

        const button = makeElement("button", "İşlem aç", "button button-small");
        button.type = "button";
        button.addEventListener("click", () => openTradeDialog(market));
        row.append(button);
        container.append(row);
    });
}

function renderOverview() {
    const totalCost = state.positions.reduce((sum, position) => sum + Number(position.amount), 0);
    const totalValue = state.positions.reduce((sum, position) => sum + position.quantity * currentPrice(position), 0);
    const totalProfit = totalValue - totalCost;
    const profitPercent = totalCost ? (totalProfit / totalCost) * 100 : 0;

    $("portfolioValue").textContent = money.format(totalValue);
    $("totalProfit").textContent = money.format(totalProfit);
    $("totalProfit").className = totalProfit >= 0 ? "positive" : "negative";
    $("totalProfitPercent").textContent = formatPercent(profitPercent);
    $("totalProfitPercent").className = totalProfit >= 0 ? "positive" : "negative";
    $("openPositionCount").textContent = state.positions.length;
    $("positionCountBadge").textContent = `${state.positions.length} pozisyon`;

    const risk = calculateRisk(totalCost);
    $("riskLevel").textContent = risk.label;
    $("riskDescription").textContent = risk.description;
    $("riskLevel").className = risk.className;
    $("riskIcon").textContent = risk.icon;
    $("riskIcon").className = `overview-icon ${risk.iconClass}`;
}

function calculateRisk(totalCost) {
    if (!state.positions.length || !totalCost) {
        return { label: "Düşük", description: "Açık işlem bulunmuyor", className: "positive", icon: "✓", iconClass: "green" };
    }

    const potentialLoss = state.positions.reduce((sum, position) => {
        return sum + (position.buyPrice - position.stopPrice) * position.quantity;
    }, 0);
    const riskPercent = (potentialLoss / totalCost) * 100;
    const nearStop = state.positions.some((position) => currentPrice(position) <= position.stopPrice * 1.02);

    if (nearStop || riskPercent > 8) {
        return { label: "Yüksek", description: nearStop ? "Bir işlem stopa yakın" : `Olası risk: %${riskPercent.toFixed(1)}`, className: "negative", icon: "!", iconClass: "orange" };
    }
    if (riskPercent > 4) {
        return { label: "Orta", description: `Olası risk: %${riskPercent.toFixed(1)}`, className: "orange-text", icon: "!", iconClass: "orange" };
    }
    return { label: "Düşük", description: `Olası risk: %${riskPercent.toFixed(1)}`, className: "positive", icon: "✓", iconClass: "green" };
}

function renderPositions() {
    const container = $("positionCards");
    container.replaceChildren();

    if (!state.positions.length) {
        const empty = document.createElement("div");
        empty.className = "empty-positions";
        empty.innerHTML = "<span>◎</span><h3>Henüz açık işlem yok</h3><p>Radar listesinden uygun bir coin seçerek ilk sanal işlemini açabilirsin.</p>";
        container.append(empty);
        return;
    }

    state.positions.forEach((position) => {
        const price = currentPrice(position);
        const value = position.quantity * price;
        const profit = value - position.amount;
        const profitPercent = (profit / position.amount) * 100;
        const recommendation = getRecommendation(position);
        const progress = getProgress(position);

        const card = document.createElement("article");
        card.className = "position-card";

        const top = document.createElement("div");
        top.className = "position-top";
        const heading = document.createElement("div");
        heading.append(makeElement("h3", position.symbol, "position-symbol"));
        heading.append(makeElement("span", `Açılış: ${position.openedAt}`, "position-date"));
        top.append(heading, makeElement("span", recommendation.text, `recommendation ${recommendation.className}`));

        const currentValue = document.createElement("div");
        currentValue.className = "position-value";
        currentValue.append(makeElement("span", "Şu anki değer"));
        currentValue.append(makeElement("strong", money.format(value), profit >= 0 ? "positive" : "negative"));

        const metrics = document.createElement("div");
        metrics.className = "position-metrics";
        [["Alış tutarı", money.format(position.amount)], ["Coin adedi", formatNumber(position.quantity)], ["Anlık kâr / zarar", money.format(profit)], ["Getiri", formatPercent(profitPercent)]].forEach(([label, valueText], index) => {
            const item = document.createElement("div");
            item.append(makeElement("span", label));
            item.append(makeElement("strong", valueText, index > 1 ? (profit >= 0 ? "positive" : "negative") : ""));
            metrics.append(item);
        });

        const progressWrap = document.createElement("div");
        progressWrap.className = "progress-wrap";
        const meta = document.createElement("div");
        meta.className = "progress-meta";
        meta.append(makeElement("span", `Hedef: ${money.format(position.targetPrice)}`));
        meta.append(makeElement("span", `Stop: ${money.format(position.stopPrice)}`));
        const track = document.createElement("div");
        track.className = "progress-track";
        const bar = document.createElement("div");
        bar.className = `progress-bar ${recommendation.progressClass}`;
        bar.style.width = `${progress}%`;
        track.append(bar);
        progressWrap.append(meta, track);

        const actions = document.createElement("div");
        actions.className = "position-actions";
        actions.append(makeElement("small", `Hedefe ilerleme: %${progress.toFixed(0)}`));
        const sell = makeElement("button", "SAT", "button button-danger button-small");
        sell.type = "button";
        sell.addEventListener("click", () => closePosition(position.id));
        actions.append(sell);

        card.append(top, currentValue, metrics, progressWrap, actions);
        container.append(card);
    });
}

function renderHistory() {
    const table = $("historyTable");
    table.replaceChildren();

    if (!state.history.length) {
        const row = document.createElement("tr");
        const cell = makeElement("td", "Henüz kapanan işlem bulunmuyor.", "empty-table");
        cell.colSpan = 5;
        row.append(cell);
        table.append(row);
        return;
    }

    state.history.forEach((item) => {
        const row = document.createElement("tr");
        [[item.closedAt, ""], [item.symbol, ""], [money.format(item.buyPrice), ""], [money.format(item.sellPrice), ""], [formatPercent(item.profitPercent), item.profitPercent >= 0 ? "positive" : "negative"]].forEach(([text, className]) => {
            const cell = makeElement("td", text, className);
            row.append(cell);
        });
        table.append(row);
    });
}

function renderInsights() {
    const list = $("aiInsights");
    list.replaceChildren();
    const insights = [];

    state.positions.forEach((position) => {
        const recommendation = getRecommendation(position);
        if (recommendation.className === "take-profit") {
            insights.push({ text: `${position.symbol} hedef fiyatına ulaştı. Kârı almayı değerlendir.`, type: "positive" });
        } else if (recommendation.className === "stop-warning") {
            insights.push({ text: `${position.symbol} stop seviyesine yaklaşıyor. Riski gözden geçir.`, type: "warning" });
        }
    });

    if (state.markets.length) {
        const strongest = state.markets[0];
        insights.push({ text: `${strongest.symbol}, %${strongest.change.toFixed(2)} değişimle radarın en güçlü hareketi.`, type: strongest.change >= 0 ? "positive" : "negative" });
    }
    if (!state.positions.length) {
        insights.push({ text: "Açık işlemin yok. İşlem açmadan önce hedef ve stop seviyeni belirle.", type: "neutral" });
    }
    if (!insights.length) {
        insights.push({ text: "Pozisyonların hedef ve stop seviyelerinden uzakta. Düzenli takibe devam et.", type: "neutral" });
    }

    insights.slice(0, 3).forEach((insight) => list.append(makeElement("li", insight.text, `insight ${insight.type}`)));
}

function renderAll() {
    renderOverview();
    renderPositions();
    renderHistory();
    renderInsights();
}

function openTradeDialog(market) {
    state.selectedMarket = market;
    $("tradeTitle").textContent = `${market.symbol} işlemi aç`;
    $("tradeCurrentPrice").textContent = money.format(market.price);
    $("amountInput").value = "";
    $("targetInput").value = "10";
    $("stopInput").value = "5";
    $("tradeDialog").showModal();
    $("amountInput").focus();
}

function closeTradeDialog() {
    $("tradeDialog").close();
    state.selectedMarket = null;
}

function createPosition(event) {
    event.preventDefault();
    const amount = Number($("amountInput").value);
    const targetPercent = Number($("targetInput").value);
    const stopPercent = Number($("stopInput").value);
    const market = state.selectedMarket;

    if (!market || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(targetPercent) || targetPercent <= 0 || !Number.isFinite(stopPercent) || stopPercent <= 0 || stopPercent >= 100) {
        showToast("Lütfen geçerli tutar, hedef ve stop değerleri girin.", true);
        return;
    }

    const position = {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        symbol: market.symbol,
        amount,
        quantity: amount / market.price,
        buyPrice: market.price,
        targetPercent,
        stopPercent,
        targetPrice: market.price * (1 + targetPercent / 100),
        stopPrice: market.price * (1 - stopPercent / 100),
        openedAt: new Date().toLocaleString("tr-TR"),
    };

    state.positions.unshift(position);
    saveStorage(POSITIONS_KEY, state.positions);
    closeTradeDialog();
    renderAll();
    showToast(`${market.symbol} sanal portföye eklendi.`);
}

function closePosition(id) {
    const index = state.positions.findIndex((position) => position.id === id);
    if (index === -1) return;

    const position = state.positions[index];
    const sellPrice = currentPrice(position);
    const currentValue = position.quantity * sellPrice;
    const profit = currentValue - position.amount;
    const profitPercent = (profit / position.amount) * 100;

    state.history.unshift({
        symbol: position.symbol,
        buyPrice: position.buyPrice,
        sellPrice,
        profit,
        profitPercent,
        closedAt: new Date().toLocaleString("tr-TR"),
    });
    state.positions.splice(index, 1);
    saveStorage(POSITIONS_KEY, state.positions);
    saveStorage(HISTORY_KEY, state.history);
    renderAll();
    showToast(`${position.symbol} işlemi kapatıldı.`);
}

function clearHistory() {
    if (!state.history.length || !window.confirm("İşlem geçmişinin tamamı silinsin mi?")) return;
    state.history = [];
    saveStorage(HISTORY_KEY, state.history);
    renderHistory();
    showToast("İşlem geçmişi temizlendi.");
}

async function loadDashboard() {
    const refresh = $("refreshButton");
    refresh.disabled = true;
    setConnection("Veri yenileniyor…");

    try {
        const response = await fetch(API_URL, { headers: { Accept: "application/json" } });
        const data = await response.json();
        if (!response.ok || data.status !== "success") throw new Error(data.message || "Piyasa verisi alınamadı.");

        state.prices = new Map(Object.entries(data.prices || {}).map(([symbol, price]) => [symbol, Number(price)]));
        state.markets = [...(data.gainers || []), ...(data.losers || [])];
        renderMarketList("gainersList", data.gainers || []);
        renderMarketList("losersList", data.losers || []);
        renderAll();
        setConnection("Canlı veri", "online");
    } catch (error) {
        console.error(error);
        setConnection("Bağlantı kurulamadı", "offline");
        showToast(error.message || "Sunucu bağlantısı kurulamadı.", true);
    } finally {
        refresh.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    $("refreshButton").addEventListener("click", loadDashboard);
    $("tradeForm").addEventListener("submit", createPosition);
    $("closeDialogButton").addEventListener("click", closeTradeDialog);
    $("cancelDialogButton").addEventListener("click", closeTradeDialog);
    $("clearHistoryButton").addEventListener("click", clearHistory);
    $("tradeDialog").addEventListener("cancel", (event) => { event.preventDefault(); closeTradeDialog(); });

    updateClock();
    setInterval(updateClock, 1_000);
    renderAll();
    loadDashboard();
    setInterval(loadDashboard, REFRESH_INTERVAL);
});

function updateClock() {
    $("clock").textContent = new Date().toLocaleTimeString("tr-TR");
}

const { createElement: h, useEffect, useMemo, useState } = React;

const POLL_MS = 60_000;

function money(value) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value || 0);
}

function pct(value) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function signedMoney(value) {
  const formatted = money(Math.abs(value || 0));
  return value < 0 ? `-${formatted}` : formatted;
}

function classFor(value) {
  return value < 0 ? "danger" : "positive";
}

function Sparkline({ points, valueKey }) {
  const values = points.map((point) => point[valueKey] || 0);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 100 - ((value - min) / span) * 88 - 6;
    return [x, y];
  });
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = coords.length > 0 ? `0,100 ${line} 100,100` : "";

  return h("svg", { className: "chart", viewBox: "0 0 100 100", preserveAspectRatio: "none" },
    h("polygon", { className: "chart-area", points: area }),
    h("polyline", { className: "chart-line", points: line }),
  );
}

function Stat({ label, value, className = "" }) {
  return h("div", { className: "stat" },
    h("span", { className: "label" }, label),
    h("span", { className: `value ${className}` }, value),
  );
}

function Card({ title, meta, children, wide = false, error = false }) {
  return h("section", { className: `card ${wide ? "wide" : ""} ${error ? "error" : ""}` },
    h("div", { className: "card-head" },
      h("h2", null, title),
      meta ? h("span", { className: "meta" }, meta) : null,
    ),
    children,
  );
}

function PnlCard({ data, history }) {
  return h(Card, { title: "P&L & Returns", meta: "1m refresh", wide: true },
    h("div", { className: `metric ${classFor(data.pnl.net)}` }, signedMoney(data.pnl.net)),
    h("div", { className: "split" },
      h(Stat, { label: "Realized P&L", value: signedMoney(data.pnl.realized), className: classFor(data.pnl.realized) }),
      h(Stat, { label: "Return", value: pct(data.pnl.returnPct), className: classFor(data.pnl.returnPct) }),
      h(Stat, { label: "Fees", value: money(data.pnl.fees), className: "danger" }),
      h(Stat, { label: "Equity", value: money(data.account.equity) }),
    ),
    h(Sparkline, { points: history, valueKey: "net" }),
  );
}

function PositionsCard({ data }) {
  return h(Card, { title: "Position & Exposure", meta: `${data.positions.activeCount} active`, wide: true },
    h("div", { className: "metric" }, money(data.positions.totalExposure)),
    h("div", { className: "split" },
      h(Stat, { label: "Cash", value: money(data.account.cash) }),
      h(Stat, { label: "Largest", value: data.positions.largest ? data.positions.largest.ticker : "None" }),
    ),
    h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Ticker"), h("th", null, "Exposure"), h("th", null, "P&L"))),
      h("tbody", null, data.positions.rows.slice(0, 6).map((position) =>
        h("tr", { key: position.ticker },
          h("td", null, position.ticker),
          h("td", null, money(position.exposure)),
          h("td", { className: classFor(position.realizedPnl) }, signedMoney(position.realizedPnl)),
        ),
      )),
    ),
  );
}

function EdgeCard({ data }) {
  return h(Card, { title: "Win Rate & Edge", meta: `${data.edge.recentFillCount} recent fills` },
    h("div", { className: "metric" }, pct(data.edge.winRate)),
    h("div", { className: "bar-track" }, h("div", { className: "bar-fill", style: { width: pct(data.edge.winRate) } })),
    h("div", { className: "split" },
      h(Stat, { label: "Wins / Losses", value: `${data.edge.wins} / ${data.edge.losses}` }),
      h(Stat, { label: "Expectancy", value: signedMoney(data.edge.expectancy), className: classFor(data.edge.expectancy) }),
      h(Stat, { label: "Avg Win", value: money(data.edge.avgWin) }),
      h(Stat, { label: "Avg Loss", value: money(data.edge.avgLoss), className: "danger" }),
    ),
  );
}

function RiskCard({ data, history }) {
  return h(Card, { title: "Risk", meta: "portfolio" },
    h("div", { className: "metric" }, pct(data.risk.exposureRatio)),
    h("div", { className: "split" },
      h(Stat, { label: "Open Risk", value: money(data.risk.openRisk) }),
      h(Stat, { label: "Concentration", value: pct(data.risk.concentrationRatio) }),
      h(Stat, { label: "Exposure Ratio", value: pct(data.risk.exposureRatio) }),
      h(Stat, { label: "Positions", value: data.positions.count }),
    ),
    h(Sparkline, { points: history, valueKey: "risk" }),
  );
}

function App() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Dashboard request failed");
      setData(payload);
      setHistory((current) => [...current.slice(-119), {
        ts: payload.timestamp,
        net: payload.pnl.net,
        returns: payload.pnl.returnPct,
        risk: payload.risk.exposureRatio,
      }]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const lastUpdated = useMemo(() => data ? new Date(data.timestamp).toLocaleTimeString() : "Waiting", [data]);

  return h("main", { className: "shell" },
    h("header", { className: "header" },
      h("div", null,
        h("p", { className: "eyebrow" }, "Kalshi Portfolio"),
        h("h1", null, "Master Dashboard"),
      ),
      h("div", { className: "status" },
        h("span", { className: "pill" }, `Updated ${lastUpdated}`),
        h("span", { className: "pill" }, "Polls every minute"),
        h("button", { onClick: refresh }, "Refresh"),
      ),
    ),
    error ? h(Card, { title: "Dashboard Error", error: true }, h("p", null, error)) : null,
    loading && !data ? h(Card, { title: "Loading" }, h("p", { className: "muted" }, "Fetching portfolio data...")) : null,
    data ? h("div", { className: "grid" },
      h(PnlCard, { data, history }),
      h(PositionsCard, { data }),
      h(EdgeCard, { data }),
      h(RiskCard, { data, history }),
    ) : null,
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));

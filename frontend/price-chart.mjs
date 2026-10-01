import { availabilityKey, priceHistory } from "./product-model.mjs?v=6";

export function renderPriceChart(element, product, fallbackDates, money) {
  const history = priceHistory(product);
  if (!history.length) {
    element.innerHTML = "";
    element.setAttribute("aria-label", "No in-stock price history");
    return;
  }
  const availableDates = product.historyDates?.filter(
    (_, index) =>
      !Array.isArray(product.historyAvailability) ||
      availabilityKey({ availabilityStatus: product.historyAvailability[index] }) !== "outOfStock"
  );
  const chartDates = availableDates?.length ? availableDates : fallbackDates;
  const width = 760;
  const height = 260;
  const pad = { top: 18, right: 34, bottom: 34, left: 54 };
  const minValue = Math.min(...history);
  const maxValue = Math.max(...history);
  const min = minValue === maxValue ? minValue - 0.5 : minValue - 0.25;
  const max = minValue === maxValue ? maxValue + 0.5 : maxValue + 0.25;
  const xStep = (width - pad.left - pad.right) / Math.max(history.length - 1, 1);
  const y = (price) => pad.top + ((max - price) / (max - min)) * (height - pad.top - pad.bottom);
  const points = history.map((price, index) => `${pad.left + index * xStep},${y(price)}`).join(" ");
  const area = `${pad.left},${height - pad.bottom} ${points} ${width - pad.right},${height - pad.bottom}`;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const gridY = pad.top + ratio * (height - pad.top - pad.bottom);
      const value = max - ratio * (max - min);
      return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${gridY}" y2="${gridY}"></line>
        <text class="chart-label" x="8" y="${gridY + 4}">${money(value)}</text>`;
    })
    .join("");

  const dots = history
    .map((price, index) => {
      const x = pad.left + index * xStep;
      return `<circle class="chart-dot" cx="${x}" cy="${y(price)}" r="${index === history.length - 1 ? 5 : 3}">
        <title>${chartDates[index] || ""}: ${money(price)}</title>
      </circle>`;
    })
    .join("");

  element.innerHTML = `
    ${grid}
    <polygon class="chart-area" points="${area}"></polygon>
    <polyline class="chart-line" points="${points}"></polyline>
    ${dots}
    <text class="chart-label" x="${pad.left}" y="${height - 9}">${String(chartDates[0] || "").slice(5, 10)}</text>
    <text class="chart-label" x="${width - pad.right - 42}" y="${height - 9}">${String(chartDates.at(-1) || "").slice(5, 10)}</text>
  `;
}

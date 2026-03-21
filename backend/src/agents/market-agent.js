/**
 * Market Agent — summarizes Bonzo /market reserves (no LLM; pure logic).
 */

function runMarketAgent(marketPayload) {
  const reserves = marketPayload?.reserves || [];
  const sorted = [...reserves].sort(
    (a, b) => (b.utilization_rate || 0) - (a.utilization_rate || 0),
  );
  const top = sorted.slice(0, 5).map((r) => ({
    symbol: r.symbol,
    utilization_rate: r.utilization_rate,
    supply_apy: r.supply_apy,
    variable_borrow_apy: r.variable_borrow_apy,
  }));
  return {
    reserveCount: reserves.length,
    timestamp: marketPayload?.timestamp,
    topByUtilization: top,
  };
}

module.exports = { runMarketAgent };

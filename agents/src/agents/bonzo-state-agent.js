/**
 * Bonzo State Agent — pulls protocol + market snapshot from Bonzo Data API.
 */
const bonzo = require("../integrations/bonzo-data-api");

async function runBonzoStateAgent() {
  const [infoResult, marketResult] = await Promise.all([bonzo.fetchInfo(), bonzo.fetchMarket()]);
  return {
    sourceBase: infoResult.baseUsed,
    info: infoResult.data,
    market: marketResult.data,
  };
}

module.exports = { runBonzoStateAgent };

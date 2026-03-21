/**
 * Execution (read-only) — Bonzo LendingPool view calls via ethers + JSON-RPC.
 * Writes / signed txs are out of scope here.
 */
const evm = require("../integrations/bonzo-evm-readonly");

/**
 * @param {{ evmAddress: string }} params
 */
async function runExecutionReadAgent(params) {
  const evmAddress = params.evmAddress;
  if (!evmAddress) {
    return { ok: false, reason: "evmAddress required" };
  }
  try {
    const position = await evm.getUserAccountDataReadOnly(evmAddress);
    return { ok: true, position };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

module.exports = { runExecutionReadAgent };

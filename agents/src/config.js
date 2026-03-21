/**
 * Env-driven endpoints. See env.sample and:
 * - Bonzo Data API: https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api
 * - Hedera Mirror REST: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 * - JSON-RPC relay: https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 */
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

function str(name, fallback) {
  const v = process.env[name];
  if (v != null && String(v).trim() !== "") return String(v).trim().replace(/\/$/, "");
  return fallback;
}

function getConfig() {
  return {
    /** Primary: documented prod base https://data.bonzo.finance/ — see Lend Data API */
    bonzoDataApiBase: str("BONZO_DATA_API_BASE", "https://data.bonzo.finance"),
    /** If primary fails, Bonzo may still list a temporary staging host in the docs */
    bonzoDataApiFallback: str(
      "BONZO_DATA_API_FALLBACK",
      "https://mainnet-data-staging.bonzo.finance",
    ),

    /**
     * Bonzo LendingPool (EVM) — must match `HEDERA_CHAIN_ID` / RPC network.
     * Default: testnet address from https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts
     */
    bonzoLendingPoolAddress: str(
      "BONZO_LENDING_POOL_ADDRESS",
      "0xf67DBe9bD1B331cA379c44b5562EAa1CE831EbC2",
    ),

    /** Hedera Mirror Node REST API v1 base (no trailing path after v1) */
    hederaMirrorRestBase: str(
      "HEDERA_MIRROR_REST_BASE",
      "https://testnet.mirrornode.hedera.com/api/v1",
    ),

    /** Hashio JSON-RPC for EVM tooling (execution path later) */
    hederaJsonRpcUrl: str("HEDERA_JSON_RPC_URL", "https://testnet.hashio.io/api"),
    hederaChainId: Number(str("HEDERA_CHAIN_ID", "296")),

    accountId: process.env.ACCOUNT_ID || "",
    evmAddress: process.env.ECDSA_EVM_ADDRESS || "",

    /** Qdrant Cloud / self-hosted — https://qdrant.tech/documentation/ */
    qdrantUrl: str("QDRANT_URL", ""),
    qdrantApiKey: process.env.QDRANT_API_KEY || "",
    qdrantCollection: str("QDRANT_COLLECTION", "b_hive_knowledge"),

    /** Preferred: Gemini embeddings (`gemini-embedding-001`, 1536-dim via API) — https://ai.google.dev/api/embeddings */
    geminiApiKey: str("GEMINI_API_KEY", "") || str("GOOGLE_API_KEY", ""),

    /** Fallback: OpenAI embeddings (`text-embedding-3-small`, 1536-dim) */
    openaiApiKey: process.env.OPENAI_API_KEY || "",
  };
}

module.exports = { getConfig, str };

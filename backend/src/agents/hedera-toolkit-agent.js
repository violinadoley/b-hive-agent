const { Client, AccountId, PrivateKey } = require("@hashgraph/sdk");
const { HederaLangchainToolkit, AgentMode } = require("hedera-agent-kit");
const { getConfig } = require("../config");
const { bonzoPlugin } = require("@bonzofinancelabs/hak-bonzo-plugin");

function buildHederaClient() {
  const cfg = getConfig();
  const accountId = process.env.ACCOUNT_ID;
  const privateKey = process.env.ECDSA_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!accountId || !privateKey) {
    throw new Error("ACCOUNT_ID and ECDSA_PRIVATE_KEY (or PRIVATE_KEY) are required");
  }
  if (cfg.hederaChainId === 296) {
    return Client.forTestnet().setOperator(
      AccountId.fromString(accountId),
      PrivateKey.fromStringECDSA(privateKey),
    );
  }
  if (cfg.hederaChainId === 295) {
    return Client.forMainnet().setOperator(
      AccountId.fromString(accountId),
      PrivateKey.fromStringECDSA(privateKey),
    );
  }
  throw new Error(`Unsupported HEDERA_CHAIN_ID for SDK client: ${cfg.hederaChainId}`);
}

async function runHederaToolkitAgentBootstrap() {
  const client = buildHederaClient();
  try {
    const toolkit = new HederaLangchainToolkit({
      client,
      configuration: {
        tools: [],
        plugins: [bonzoPlugin],
        context: { mode: AgentMode.AUTONOMOUS },
      },
    });
    const tools = toolkit.getTools();
    return {
      ok: true,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name || "unknown"),
    };
  } finally {
    client.close();
  }
}

module.exports = {
  buildHederaClient,
  runHederaToolkitAgentBootstrap,
};

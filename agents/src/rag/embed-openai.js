/**
 * OpenAI embeddings for Qdrant vectors (optional).
 * Model: text-embedding-3-small (1536 dimensions by default).
 */
const EMBED_MODEL = "text-embedding-3-small";
const VECTOR_SIZE = 1536;

async function embedTexts(texts, apiKey) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for embedding");
  }
  const inputs = texts.map((t) => String(t).slice(0, 8000));
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI embeddings HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const out = data.data.map((d) => d.embedding);
  if (out.length !== inputs.length) {
    throw new Error("OpenAI embeddings: unexpected response shape");
  }
  return out;
}

async function embedQuery(text, apiKey) {
  const [v] = await embedTexts([text], apiKey);
  return v;
}

module.exports = {
  embedTexts,
  embedQuery,
  EMBED_MODEL,
  VECTOR_SIZE,
};

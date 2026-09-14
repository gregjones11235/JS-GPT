import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { QdrantVectorStore } from "langchain/vectorstores/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { PromptTemplate } from "langchain/prompts";
import { LLMChain } from "langchain/chains";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { CohereClient } from "cohere-ai";

// --- config ---
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const TOP_K1 = Number(process.env.RAG_TOP_K1) || 20; // ANN 粗召回数量
const TOP_K2 = Number(process.env.RAG_TOP_K2) || 4; // rerank 后送入 LLM 的数量
const RERANK_MODEL = process.env.COHERE_RERANK_MODEL || "rerank-v3.5";

// --- shared clients (created once per process) ---
const qdrant = new QdrantClient({ url: QDRANT_URL });
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
});
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
const model = new ChatOpenAI({
  modelName: "gpt-3.5-turbo", //cheap, but should be gpt-5 in the resume
  openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
});

const template = `Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
Use three sentences maximum and keep the answer as concise as possible.

{context}
Question: {question}
Helpful Answer:`;

const qaChain = new LLMChain({
  llm: model,
  prompt: PromptTemplate.fromTemplate(template),
});

// Collection name is derived from file content, so re-uploading the same PDF
// (even under a different name) reuses the existing index instead of re-embedding.
export const collectionNameFor = async (filePath) => {
  const bytes = await readFile(filePath);
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 16);
  return `doc_${hash}`;
};

export const collectionHasPoints = async (collectionName) => {
  const { collections } = await qdrant.getCollections();
  if (!collections.some((c) => c.name === collectionName)) return false;
  const info = await qdrant.getCollection(collectionName);
  return (info.points_count ?? 0) > 0;
};

export const deleteCollection = async (collectionName) => {
  const { collections } = await qdrant.getCollections();
  if (collections.some((c) => c.name === collectionName)) {
    await qdrant.deleteCollection(collectionName);
  }
};

/**
 * Ingest a PDF once: load -> split -> embed -> store in Qdrant.
 * Runs at upload time; /chat never rebuilds the index.
 */
export const ingest = async (filePath) => {
  const collectionName = await collectionNameFor(filePath);

  if (await collectionHasPoints(collectionName)) {
    return { collectionName, chunks: 0, cached: true };
  }

  // step 1: loading
  const loader = new PDFLoader(filePath);
  const data = await loader.load();
  // step 2: splitting
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500, //  (in terms of number of characters)
    chunkOverlap: 50,
  });
  const splitDocs = await textSplitter.splitDocuments(data);
  // step 3: embedding + indexing (Qdrant builds an HNSW index over the vectors)
  await QdrantVectorStore.fromDocuments(splitDocs, embeddings, {
    client: qdrant,
    collectionName,
  });

  return { collectionName, chunks: splitDocs.length, cached: false };
};

/**
 * Two-stage retrieval: ANN recall (TOP_K1) -> Cohere rerank (TOP_K2) -> LLM.
 */
export const chat = async (collectionName, query) => {
  // step 4a: coarse recall from the ANN (HNSW) index
  const queryVector = await embeddings.embedQuery(query);
  const { points } = await qdrant.query(collectionName, {
    query: queryVector,
    limit: TOP_K1,
    with_payload: true,
  });
  // Payload shape matches what QdrantVectorStore.addVectors writes at ingest
  const candidates = points.map((p) => ({
    pageContent: p.payload.content,
    metadata: p.payload.metadata,
  }));
  if (candidates.length === 0) {
    return { text: "I don't know.", sources: [] };
  }

  // step 4b: rerank with a cross-encoder and keep the top few
  const reranked = await cohere.rerank({
    model: RERANK_MODEL,
    query,
    documents: candidates.map((d) => d.pageContent),
    topN: Math.min(TOP_K2, candidates.length),
  });
  const selected = reranked.results.map((r) => ({
    doc: candidates[r.index],
    score: r.relevanceScore,
  }));

  // step 5: prompt construction + generation
  const context = selected.map((s) => s.doc.pageContent).join("\n\n");
  const response = await qaChain.call({ context, question: query });

  return {
    text: response.text,
    sources: selected.map((s) => ({
      score: s.score,
      page: s.doc.metadata?.loc?.pageNumber,
      content: s.doc.pageContent,
    })),
  };
};

/**
 * Plain LLM answer with no retrieval, used when no PDF is active.
 */
export const chatWithoutContext = async (query) => {
  const response = await model.predict(query);
  return { text: response, sources: [] };
};

export default chat;

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer"; // Import multer
import path from "path";
import { readdir, stat, unlink } from "fs/promises";

dotenv.config();

// chat.js reads env at import time, so load it only after dotenv.config()
const {
  ingest,
  chat,
  chatWithoutContext,
  collectionNameFor,
  collectionHasPoints,
  deleteCollection,
} = await import("./chat.js");

const app = express();
app.use(cors());

const UPLOAD_DIR = "uploads";

// Configure multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, `${UPLOAD_DIR}/`);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: storage });

const PORT = 5050;
// The PDF currently being queried: its file name and its Qdrant collection
let activeFile;
let activeCollection;

const setActive = (filePath, collectionName) => {
  activeFile = filePath ? path.basename(filePath) : undefined;
  activeCollection = collectionName;
};

// Strip any directory components so a request can't reach outside uploads/
const safeUploadPath = (name) => path.join(UPLOAD_DIR, path.basename(name));

const listFiles = async () => {
  const names = (await readdir(UPLOAD_DIR)).filter((n) =>
    n.toLowerCase().endsWith(".pdf")
  );
  const files = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(UPLOAD_DIR, name);
      const info = await stat(filePath);
      const collectionName = await collectionNameFor(filePath);
      return {
        name,
        size: info.size,
        uploadedAt: info.mtime,
        collectionName,
        indexed: await collectionHasPoints(collectionName),
        active: name === activeFile,
      };
    })
  );
  return files.sort((a, b) => b.uploadedAt - a.uploadedAt);
};

app.post("/upload", upload.single("file"), async (req, res) => {
  // Use multer to handle file upload
  const filePath = req.file.path; // The path where the file is temporarily saved
  try {
    // Build the index once, at upload time
    const result = await ingest(filePath);
    setActive(filePath, result.collectionName);
    const msg = result.cached
      ? `${filePath} already indexed (${result.collectionName}).`
      : `${filePath} indexed: ${result.chunks} chunks -> ${result.collectionName}.`;
    console.log(msg);
    res.send(msg);
  } catch (err) {
    console.error("Ingest failed:", err);
    // Don't keep a file around that we couldn't index
    await unlink(filePath).catch(() => {});
    res.status(500).send(`Failed to index ${filePath}: ${err.message}`);
  }
});

app.get("/files", async (req, res) => {
  try {
    res.json(await listFiles());
  } catch (err) {
    console.error("List files failed:", err);
    res.status(500).send(`Failed to list files: ${err.message}`);
  }
});

// Clear the active file; /chat returns 400 until another one is selected
app.post("/files/deselect", async (req, res) => {
  setActive(undefined, undefined);
  res.json({ active: null, files: await listFiles() });
});

// Make an already-uploaded file the one /chat queries
app.post("/files/:name/select", async (req, res) => {
  const filePath = safeUploadPath(req.params.name);
  try {
    const result = await ingest(filePath); // no-op if already indexed
    setActive(filePath, result.collectionName);
    res.json({ active: activeFile, collectionName: activeCollection });
  } catch (err) {
    console.error("Select failed:", err);
    res.status(500).send(`Failed to select ${filePath}: ${err.message}`);
  }
});

app.delete("/files/:name", async (req, res) => {
  const filePath = safeUploadPath(req.params.name);
  try {
    const collectionName = await collectionNameFor(filePath);
    await unlink(filePath);

    // Files with identical content share a collection; only drop it when the
    // last such file is gone.
    const remaining = await listFiles();
    const stillReferenced = remaining.some((f) => f.collectionName === collectionName);
    if (!stillReferenced) {
      await deleteCollection(collectionName);
    }

    if (activeFile === path.basename(filePath)) {
      // Fall back to the most recently uploaded indexed file, if any
      const next = remaining.find((f) => f.indexed);
      setActive(next?.name, next?.collectionName);
    }

    console.log(`Deleted ${filePath}${stillReferenced ? "" : ` and collection ${collectionName}`}`);
    res.json({ deleted: path.basename(filePath), files: await listFiles() });
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).send(`File not found: ${req.params.name}`);
    }
    console.error("Delete failed:", err);
    res.status(500).send(`Failed to delete ${filePath}: ${err.message}`);
  }
});

app.get("/chat", async (req, res) => {
  try {
    // With no active PDF, fall back to a plain LLM answer (no RAG)
    const resp = activeCollection
      ? await chat(activeCollection, req.query.question)
      : await chatWithoutContext(req.query.question);
    res.send(resp.text);
  } catch (err) {
    console.error("Chat failed:", err);
    res.status(500).send(`Chat failed: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

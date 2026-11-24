// KI database for the platform collections (users, projects, plugins, ...), used by /v1/database.
// It keeps the same rules as before (whitelisted collections, UUID ids, 64 KB per document, 1000 per collection)
// but stores the documents in the ONE KI database (src/db.mjs, ~/.ki/ki.db) instead of its own folder.
// The first time a collection is read, the older file ~/.ki-database/<collection>.json is copied in once
// and left untouched, so nothing is lost and it stays as a backup.
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { makeStore, engine } from "./db.mjs";

const OLD_DIR = () => path.join(process.env.HOME ?? os.homedir(), ".ki-database");

const COLLECTIONS = new Set([
  "users",
  "projects",
  "plugins",
  "integrations",
  "developer_accounts",
  "api_usage"
]);

const MAX_DOC_SIZE = 64 * 1024;
const MAX_DOCS = 1000;

const queues = new Map();
const stores = new Map();

function validateCollection(name) {
  if (typeof name !== "string" || !COLLECTIONS.has(name)) {
    throw new Error("INVALID_COLLECTION");
  }
  return name;
}

function validateId(id) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) {
    throw new Error("INVALID_ID");
  }
  return id;
}

// Stored under the name "database-<collection>" (never starts with "data-", so /v1/data does not list it).
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, makeStore("database-" + name));
  return stores.get(name);
};

// The previous version kept ~/.ki-database/<collection>.json. Returns its documents, or [] when there is nothing usable.
function oldDocuments(name) {
  const file = path.join(OLD_DIR(), `${name}.json`);
  try {
    if (!existsSync(file)) return [];
    const docs = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(docs) ? docs : [];
  } catch {
    return []; // broken old file: leave it alone, start empty
  }
}

async function readCollection(name) {
  validateCollection(name);
  const store = storeFor(name);
  let docs = store.load(null);
  if (docs === null) {
    docs = oldDocuments(name);
    if (docs.length) store.save(docs); // copied in once; the old file stays
  }
  if (!Array.isArray(docs)) throw new Error("DATABASE_CORRUPTED");
  return docs;
}

async function writeCollection(name, docs) {
  validateCollection(name);
  if (docs.length > MAX_DOCS) throw new Error("COLLECTION_LIMIT");
  storeFor(name).save(docs);
}

async function withLock(name, callback) {
  const previous = queues.get(name) ?? Promise.resolve();

  let release;
  const current = new Promise(resolve => {
    release = resolve;
  });

  queues.set(name, current);

  await previous;

  try {
    return await callback();
  } finally {
    release();

    if (queues.get(name) === current) {
      queues.delete(name);
    }
  }
}

export async function databaseHealth() {
  return {
    ok: true,
    service: "KI_DATABASE",
    storage: "local",
    engine: engine(),
    collections: COLLECTIONS.size
  };
}

export async function databaseList() {
  return [...COLLECTIONS];
}

export async function databaseGet(collection, id) {
  validateCollection(collection);
  validateId(id);

  const docs = await readCollection(collection);

  return docs.find(doc => doc.id === id) ?? null;
}

export async function databaseInsert(collection, input) {
  validateCollection(collection);

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("INVALID_DOCUMENT");
  }

  const size = Buffer.byteLength(JSON.stringify(input));

  if (size > MAX_DOC_SIZE) {
    throw new Error("DOCUMENT_TOO_LARGE");
  }

  return withLock(collection, async () => {
    const docs = await readCollection(collection);

    if (docs.length >= MAX_DOCS) {
      throw new Error("COLLECTION_LIMIT");
    }

    const doc = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    docs.push(doc);
    await writeCollection(collection, docs);

    return doc;
  });
}

export async function databaseUpdate(collection, id, input) {
  validateCollection(collection);
  validateId(id);

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("INVALID_DOCUMENT");
  }

  const protectedFields = ["id", "createdAt"];
  for (const field of protectedFields) {
    if (Object.hasOwn(input, field)) {
      throw new Error("PROTECTED_FIELD");
    }
  }

  if (Buffer.byteLength(JSON.stringify(input)) > MAX_DOC_SIZE) {
    throw new Error("DOCUMENT_TOO_LARGE");
  }

  return withLock(collection, async () => {
    const docs = await readCollection(collection);
    const index = docs.findIndex(doc => doc.id === id);

    if (index === -1) return null;

    docs[index] = {
      ...docs[index],
      ...input,
      id,
      updatedAt: new Date().toISOString()
    };

    if (Buffer.byteLength(JSON.stringify(docs[index])) > MAX_DOC_SIZE) {
      throw new Error("DOCUMENT_TOO_LARGE");
    }

    await writeCollection(collection, docs);

    return docs[index];
  });
}

export async function databaseDelete(collection, id) {
  validateCollection(collection);
  validateId(id);

  return withLock(collection, async () => {
    const docs = await readCollection(collection);
    const next = docs.filter(doc => doc.id !== id);

    if (next.length === docs.length) {
      return false;
    }

    await writeCollection(collection, next);
    return true;
  });
}

export async function databaseFind(collection) {
  return readCollection(collection);
}

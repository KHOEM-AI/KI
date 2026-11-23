import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DATA_DIR = path.join(os.homedir(), ".ki-database");

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

function validateCollection(name) {
  if (
    typeof name !== "string" ||
    !COLLECTIONS.has(name)
  ) {
    throw new Error("INVALID_COLLECTION");
  }

  return name;
}

function validateId(id) {
  if (
    typeof id !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(id)
  ) {
    throw new Error("INVALID_ID");
  }

  return id;
}

async function ensureDirectory() {
  await fs.mkdir(DATA_DIR, {
    recursive: true,
    mode: 0o700
  });
}

async function readCollection(name) {
  validateCollection(name);
  await ensureDirectory();

  const file = path.join(DATA_DIR, `${name}.json`);

  try {
    const raw = await fs.readFile(file, "utf8");
    const docs = JSON.parse(raw);

    if (!Array.isArray(docs)) {
      throw new Error("DATABASE_CORRUPTED");
    }

    return docs;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeCollection(name, docs) {
  validateCollection(name);

  if (docs.length > MAX_DOCS) {
    throw new Error("COLLECTION_LIMIT");
  }

  await ensureDirectory();

  const file = path.join(DATA_DIR, `${name}.json`);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.writeFile(
      temp,
      JSON.stringify(docs, null, 2),
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      }
    );

    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
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
  await ensureDirectory();

  return {
    ok: true,
    service: "KI_DATABASE",
    storage: "local",
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

  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
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

  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
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

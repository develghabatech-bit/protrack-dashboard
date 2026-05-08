import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, ServerApiVersion } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");

// MongoDB Setup
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || "protrack_db";
const COLLECTION_NAME = "functionalities";

let mongoClient: MongoClient | null = null;
let lastConnectionError: string | null = null;

async function getMongoClient() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri || uri === "") {
    lastConnectionError = "MONGODB_URI is not set or empty";
    return null;
  }
  
  if (!mongoClient) {
    try {
      if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
        lastConnectionError = "Invalid MONGODB_URI scheme (must be mongodb:// or mongodb+srv://)";
        return null;
      }

      mongoClient = new MongoClient(uri, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
        connectTimeoutMS: 5000,
        serverSelectionTimeoutMS: 5000,
      });
      await mongoClient.connect();
      console.log("Connected to MongoDB Atlas");
      lastConnectionError = null;
    } catch (error) {
      lastConnectionError = error instanceof Error ? error.message : String(error);
      console.error("MongoDB Connection Failed:", lastConnectionError);
      mongoClient = null; 
      return null;
    }
  }
  return mongoClient;
}

async function getFunctionalities() {
  try {
    const client = await getMongoClient();
    if (client) {
      const db = client.db(DB_NAME);
      const collection = db.collection(COLLECTION_NAME);
      const data = await collection.find({}).toArray();
      
      if (data.length === 0) {
        try {
          const fileData = await fs.readFile(DATA_FILE, "utf-8");
          const initialData = JSON.parse(fileData);
          if (initialData.length > 0) {
            await collection.insertMany(initialData);
            return initialData;
          }
        } catch (e) {}
      }
      return data;
    } else {
      const data = await fs.readFile(DATA_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error reading data:", error);
    return [];
  }
}

async function saveFunctionality(func: any) {
  const client = await getMongoClient();
  
  // Clean up subtasks if they come as a string
  if (typeof func.subtasks === 'string') {
    try {
      func.subtasks = JSON.parse(func.subtasks);
    } catch (e) {
      func.subtasks = [];
    }
  }
  func.subtasks = func.subtasks || [];

  if (client) {
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    if (func.id && func.id !== "") {
      const { _id, ...updateData } = func;
      await collection.updateOne({ id: func.id }, { $set: updateData }, { upsert: true });
    } else {
      func.id = Math.random().toString(36).substr(2, 9);
      func.status = func.status || "Not started";
      await collection.insertOne(func);
    }
  } else {
    let data = await getFunctionalities();
    if (func.id && func.id !== "") {
      const index = data.findIndex((f: any) => f.id === func.id);
      if (index !== -1) {
        data[index] = { ...data[index], ...func };
      }
    } else {
      func.id = Math.random().toString(36).substr(2, 9);
      func.status = func.status || "Not started";
      data.push(func);
    }
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  }
}

async function deleteFunctionality(id: string) {
  const client = await getMongoClient();
  if (client) {
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    await collection.deleteOne({ id });
  } else {
    const data = await getFunctionalities();
    const filtered = data.filter((f: any) => f.id !== id);
    await fs.writeFile(DATA_FILE, JSON.stringify(filtered, null, 2), "utf-8");
  }
}

async function startServer() {
  const app = express();
  const PORT = 5173;

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Main Route
  app.get("/", async (req, res) => {
    try {
      const functionalities = await getFunctionalities();
      const client = await getMongoClient();
      const dbStatus = {
        mode: client ? "mongodb" : "local-file",
        error: lastConnectionError
      };
      res.render("index", { functionalities, dbStatus });
    } catch (err) {
      res.status(500).send("Error rendering page: " + String(err));
    }
  });

  // Action Routes
  app.post("/api/save", async (req, res) => {
    try {
      await saveFunctionality(req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/import", async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) throw new Error("Items must be an array");
      
      for (const item of items) {
        await saveFunctionality(item);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/update-status/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const client = await getMongoClient();
      if (client) {
        await client.db(DB_NAME).collection(COLLECTION_NAME).updateOne({ id }, { $set: updates });
      } else {
        const data = await getFunctionalities();
        const updated = data.map((f: any) => f.id === id ? { ...f, ...updates } : f);
        await fs.writeFile(DATA_FILE, JSON.stringify(updated, null, 2), "utf-8");
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.delete("/api/delete/:id", async (req, res) => {
    try {
      await deleteFunctionality(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

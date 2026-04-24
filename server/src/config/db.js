import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { env } from "./env.js";

let memoryServer;

export const connectDb = async () => {
  const shouldUseMemory = process.env.USE_IN_MEMORY_DB === "true";

  if (shouldUseMemory) {
    memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri();
    await mongoose.connect(uri);
    console.log("MongoDB in-memory connected");
    return;
  }

  if (!env.mongoUri) {
    throw new Error("MONGO_URI is missing in environment");
  }

  try {
    await mongoose.connect(env.mongoUri);
    console.log("MongoDB connected");
  } catch (error) {
    console.warn("Local MongoDB unavailable. Falling back to in-memory MongoDB for testing.");
    memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri();
    await mongoose.connect(uri);
    console.log("MongoDB in-memory connected");
  }
};

export const closeDb = async () => {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = undefined;
  }
};

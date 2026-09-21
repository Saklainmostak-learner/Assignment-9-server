import "dotenv/config";
import express from "express";
import cors from "cors";
import dns from "node:dns";
import { MongoClient } from "mongodb";

dns.setServers(["8.8.8.8"]);

const app = express();

const port = process.env.PORT || 5000;
const clientURL =
  process.env.CLIENT_URL || "http://localhost:5173";

const corsOptions = {
  origin: clientURL,
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

app.get("/", (request, response) => {
  response.send("PlayGrid server is running");
});

app.get("/api/health", (request, response) => {
  response.status(200).json({
    success: true,
    message: "PlayGrid API is healthy",
  });
});

async function startServer() {
  try {
    if (!process.env.MONGODB_URL) {
      throw new Error(
        "MONGODB_URI is missing from the .env file"
      );
    }

    const mongoClient = new MongoClient(
      process.env.MONGODB_URL
    );

    await mongoClient.connect();

    const database = mongoClient.db(
      process.env.DB_NAME || "playgrid"
    );

    await database.command({ ping: 1 });

    app.locals.database = database;
    app.locals.mongoClient = mongoClient;

    console.log("MongoDB connected successfully");

    app.listen(port, () => {
      console.log(
        `PlayGrid server is running on http://localhost:${port}`
      );
    });
  } catch (error) {
    console.error(
      "Failed to start PlayGrid server:",
      error.message
    );

    process.exit(1);
  }
}

startServer();
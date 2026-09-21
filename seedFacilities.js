import "dotenv/config";
import dns from "node:dns";
import { MongoClient } from "mongodb";

dns.setServers(["8.8.8.8"]);

const mongoClient = new MongoClient(
  process.env.MONGODB_URL
);

async function seedFacilities() {
  try {
    const dataModule = await import(
      "../client/src/data/facilities.jsx"
    );

    const facilities =
      dataModule.default ||
      dataModule.facilities ||
      Object.values(dataModule).find(Array.isArray);

    if (!Array.isArray(facilities)) {
      throw new Error(
        "No facilities array was found in client/src/data/facilities.js"
      );
    }

    if (facilities.length === 0) {
      throw new Error(
        "The facilities data array is empty"
      );
    }

    await mongoClient.connect();

    const database = mongoClient.db(
      process.env.DB_NAME || "playgrid"
    );

    const facilitiesCollection =
      database.collection("facilities");

    const existingCount =
      await facilitiesCollection.countDocuments();

    if (existingCount > 0) {
      console.log(
        `Seed stopped: facilities collection already contains ${existingCount} documents.`
      );

      return;
    }

    const currentDate = new Date();

    const facilitiesToInsert = facilities.map(
      (facility) => ({
        ...facility,
        createdAt: currentDate,
        updatedAt: currentDate,
      })
    );

    const result =
      await facilitiesCollection.insertMany(
        facilitiesToInsert
      );

    console.log(
      `${result.insertedCount} facilities inserted successfully`
    );
  } catch (error) {
    console.error(
      "Failed to seed facilities:",
      error.message
    );
  } finally {
    await mongoClient.close();
  }
}

seedFacilities();
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

        const facilitiesCollection =
            database.collection("facilities");

        // Get all facilities with search and filter
        app.get("/api/facilities", async (request, response) => {
            try {
                const search = request.query.search?.trim();
                const sports = request.query.sports
                    ?.split(",")
                    .map((sport) => sport.trim())
                    .filter(Boolean);

                const query = {};

                if (search) {
                    query.$or = [
                        {
                            name: {
                                $regex: search,
                                $options: "i",
                            },
                        },
                        {
                            location: {
                                $regex: search,
                                $options: "i",
                            },
                        },
                    ];
                }

                if (sports?.length) {
                    query.sportType = {
                        $in: sports,
                    };
                }

                const facilities = await facilitiesCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .toArray();

                response.status(200).json(facilities);
            } catch (error) {
                console.error("Failed to get facilities:", error);

                response.status(500).json({
                    success: false,
                    message: "Failed to load facilities",
                });
            }
        });

        // Get one facility by MongoDB ID
        app.get(
            "/api/facilities/:id",
            async (request, response) => {
                try {
                    const { id } = request.params;

                    if (!ObjectId.isValid(id)) {
                        return response.status(400).json({
                            success: false,
                            message: "Invalid facility ID",
                        });
                    }

                    const facility =
                        await facilitiesCollection.findOne({
                            _id: new ObjectId(id),
                        });

                    if (!facility) {
                        return response.status(404).json({
                            success: false,
                            message: "Facility not found",
                        });
                    }

                    response.status(200).json(facility);
                } catch (error) {
                    console.error("Failed to get facility:", error);

                    response.status(500).json({
                        success: false,
                        message: "Failed to load the facility",
                    });
                }
            }
        );

        // Add a new facility
        app.post("/api/facilities", async (request, response) => {
            try {
                const facilityData = request.body;

                const requiredFields = [
                    "name",
                    "sportType",
                    "location",
                    "pricePerHour",
                ];

                const missingFields = requiredFields.filter(
                    (field) =>
                        facilityData[field] === undefined ||
                        facilityData[field] === ""
                );

                if (missingFields.length) {
                    return response.status(400).json({
                        success: false,
                        message: `Missing fields: ${missingFields.join(", ")}`,
                    });
                }

                const newFacility = {
                    ...facilityData,
                    pricePerHour: Number(
                        facilityData.pricePerHour
                    ),
                    capacity: Number(facilityData.capacity || 0),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                const result =
                    await facilitiesCollection.insertOne(newFacility);

                response.status(201).json({
                    success: true,
                    message: "Facility added successfully",
                    insertedId: result.insertedId,
                });
            } catch (error) {
                console.error("Failed to add facility:", error);

                response.status(500).json({
                    success: false,
                    message: "Failed to add facility",
                });
            }
        });

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
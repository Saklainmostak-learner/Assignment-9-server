import "dotenv/config";
import express from "express";
import cors from "cors";
import dns from "node:dns";
import { MongoClient, ObjectId } from "mongodb";

dns.setServers(["8.8.8.8"]);

const app = express();

const port = process.env.PORT || 5000;

const clientURL =
    process.env.CLIENT_URL || "http://localhost:5173";

const mongoURL =
    process.env.MONGODB_URL ||
    process.env.MONGODB_URL;

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
        if (!mongoURL) {
            throw new Error(
                "MONGODB_URI is missing from the .env file"
            );
        }

        const mongoClient = new MongoClient(mongoURL);

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
        app.get(
            "/api/facilities",
            async (request, response) => {
                try {
                    const search =
                        request.query.search?.trim();

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
                        query.facility_type = {
                            $in: sports,
                        };
                    }

                    const facilities =
                        await facilitiesCollection
                            .find(query)
                            .sort({ createdAt: -1 })
                            .toArray();

                    response.status(200).json(facilities);
                } catch (error) {
                    console.error(
                        "Failed to get facilities:",
                        error
                    );

                    response.status(500).json({
                        success: false,
                        message: "Failed to load facilities",
                    });
                }
            }
        );

        // Get all unique facility types
        app.get(
            "/api/facility-types",
            async (request, response) => {
                try {
                    const facilityTypes =
                        await facilitiesCollection.distinct(
                            "facility_type"
                        );

                    const sortedTypes = facilityTypes
                        .filter(Boolean)
                        .sort((firstType, secondType) =>
                            firstType.localeCompare(secondType)
                        );

                    response.status(200).json(sortedTypes);
                } catch (error) {
                    console.error(
                        "Failed to get facility types:",
                        error
                    );

                    response.status(500).json({
                        success: false,
                        message: "Failed to load facility types",
                    });
                }
            }
        );
        // Get one facility by MongoDB ID or legacy numeric ID
        app.get(
            "/api/facilities/:id",
            async (request, response) => {
                try {
                    const { id } = request.params;

                    let facilityQuery;

                    if (ObjectId.isValid(id)) {
                        facilityQuery = {
                            _id: new ObjectId(id),
                        };
                    } else {
                        const numericId = Number(id);

                        if (!Number.isInteger(numericId)) {
                            return response.status(400).json({
                                success: false,
                                message: "Invalid facility ID",
                            });
                        }

                        facilityQuery = {
                            id: numericId,
                        };
                    }

                    const facility =
                        await facilitiesCollection.findOne(
                            facilityQuery
                        );

                    if (!facility) {
                        return response.status(404).json({
                            success: false,
                            message: "Facility not found",
                        });
                    }

                    response.status(200).json(facility);
                } catch (error) {
                    console.error(
                        "Failed to get facility:",
                        error
                    );

                    response.status(500).json({
                        success: false,
                        message: "Failed to load the facility",
                    });
                }
            }
        );

        // Add a new facility
        app.post(
            "/api/facilities",
            async (request, response) => {
                try {
                    const facilityData = request.body;

                    const facilityType =
                        facilityData.facility_type ||
                        facilityData.sportType;

                    const pricePerHour =
                        facilityData.price_per_hour ??
                        facilityData.pricePerHour ??
                        facilityData.price;

                    const requiredValues = {
                        name: facilityData.name,
                        facility_type: facilityType,
                        location: facilityData.location,
                        price_per_hour: pricePerHour,
                    };

                    const missingFields = Object.entries(
                        requiredValues
                    )
                        .filter(
                            ([, value]) =>
                                value === undefined ||
                                value === null ||
                                String(value).trim() === ""
                        )
                        .map(([field]) => field);

                    if (missingFields.length) {
                        return response.status(400).json({
                            success: false,
                            message: `Missing fields: ${missingFields.join(
                                ", "
                            )}`,
                        });
                    }

                    const numericPrice = Number(pricePerHour);

                    if (Number.isNaN(numericPrice)) {
                        return response.status(400).json({
                            success: false,
                            message:
                                "Price per hour must be a valid number",
                        });
                    }

                    const {
                        sportType,
                        pricePerHour: camelCasePrice,
                        ...remainingData
                    } = facilityData;

                    const newFacility = {
                        ...remainingData,
                        facility_type: facilityType,
                        price_per_hour: numericPrice,
                        capacity: Number(
                            facilityData.capacity || 0
                        ),
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };

                    const result =
                        await facilitiesCollection.insertOne(
                            newFacility
                        );

                    response.status(201).json({
                        success: true,
                        message: "Facility added successfully",
                        insertedId: result.insertedId,
                    });
                } catch (error) {
                    console.error(
                        "Failed to add facility:",
                        error
                    );

                    response.status(500).json({
                        success: false,
                        message: "Failed to add facility",
                    });
                }
            }
        );

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
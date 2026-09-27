import "dotenv/config";
import express from "express";
import cors from "cors";
import dns from "node:dns";
import { MongoClient, ObjectId } from "mongodb";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { createAuth } from "./auth.js";
import {
    accessCookie,
    clearAccessCookie,
    createAccessToken,
    readCookie,
    verifyAccessToken,
} from "./jwt.js";

dns.setServers(["8.8.8.8"]);

const app = express();
const port = Number(process.env.PORT || 5000);
const mongoURL = process.env.MONGODB_URL || process.env.MONGODB_URI;
const clientOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(
    cors({
        origin(origin, callback) {
            if (!origin || clientOrigins.includes(origin)) {
                callback(null, true);
                return;
            }

            callback(new Error("Origin is not allowed by CORS"));
        },
        credentials: true,
    })
);

app.get("/", (_request, response) => {
    response.send("PlayGrid server is running");
});

app.get("/api/health", (_request, response) => {
    response.status(200).json({
        success: true,
        message: "PlayGrid API is healthy",
    });
});

function objectIdQuery(id) {
    return ObjectId.isValid(id) ? { _id: new ObjectId(id) } : null;
}

function cleanText(value) {
    return String(value ?? "").trim();
}

function normalizeSlots(value) {
    const slots = Array.isArray(value)
        ? value
        : cleanText(value).split(",");

    return slots.map(cleanText).filter(Boolean);
}

async function startServer() {
    try {
        if (!mongoURL) {
            throw new Error("MONGODB_URL is missing from the environment");
        }

        if (!process.env.BETTER_AUTH_SECRET && !process.env.JWT_SECRET) {
            throw new Error("BETTER_AUTH_SECRET or JWT_SECRET is required");
        }

        const mongoClient = new MongoClient(mongoURL);
        await mongoClient.connect();

        const database = mongoClient.db(process.env.DB_NAME || "playgrid");
        await database.command({ ping: 1 });

        const facilitiesCollection = database.collection("facilities");
        const bookingsCollection = database.collection("bookings");
        const auth = createAuth(database, mongoClient);

        app.locals.database = database;
        app.locals.mongoClient = mongoClient;
        app.locals.auth = auth;

        app.all("/api/auth/*splat", toNodeHandler(auth));
        app.use(express.json({ limit: "1mb" }));

        async function requireUser(request, response, next) {
            try {
                const token = readCookie(request, "playgrid_access_token");
                const jwtUser = verifyAccessToken(token);

                if (jwtUser) {
                    request.user = jwtUser;
                    next();
                    return;
                }

                const session = await auth.api.getSession({
                    headers: fromNodeHeaders(request.headers),
                });

                if (!session?.user) {
                    response.status(401).json({
                        success: false,
                        message: "Authentication required",
                    });
                    return;
                }

                response.setHeader(
                    "Set-Cookie",
                    accessCookie(createAccessToken(session.user))
                );
                request.user = {
                    sub: session.user.id,
                    email: session.user.email,
                    name: session.user.name || "",
                };
                next();
            } catch (error) {
                console.error("Authentication failed:", error);
                response.status(401).json({
                    success: false,
                    message: "Your session is not valid",
                });
            }
        }

        app.post("/api/session/logout", (_request, response) => {
            response.setHeader("Set-Cookie", clearAccessCookie());
            response.status(200).json({ success: true });
        });

        app.get("/api/facilities", async (request, response) => {
            try {
                const search = cleanText(request.query.search);
                const sports = cleanText(request.query.sports)
                    .split(",")
                    .map((sport) => sport.trim())
                    .filter(Boolean);
                const query = {};

                if (search) {
                    const safeSearch = search.replace(
                        /[.*+?^${}()|[\]\\]/g,
                        "\\$&"
                    );
                    query.$or = [
                        { name: { $regex: safeSearch, $options: "i" } },
                        { location: { $regex: safeSearch, $options: "i" } },
                    ];
                }

                if (sports.length) {
                    query.facility_type = { $in: sports };
                }

                let cursor = facilitiesCollection
                    .find(query)
                    .sort({ createdAt: -1, _id: -1 });

                if (request.query.featured === "true") {
                    cursor = cursor.limit(6);
                }

                response.status(200).json(await cursor.toArray());
            } catch (error) {
                console.error("Failed to get facilities:", error);
                response.status(500).json({
                    success: false,
                    message: "Failed to load facilities",
                });
            }
        });

        app.get("/api/facility-types", async (_request, response) => {
            try {
                const types = await facilitiesCollection.distinct(
                    "facility_type"
                );
                response.status(200).json(
                    types
                        .filter(Boolean)
                        .sort((first, second) => first.localeCompare(second))
                );
            } catch (error) {
                console.error("Failed to get facility types:", error);
                response.status(500).json({
                    success: false,
                    message: "Failed to load facility types",
                });
            }
        });

        app.get(
            "/api/facilities/:id",
            requireUser,
            async (request, response) => {
                try {
                    const query = objectIdQuery(request.params.id);

                    if (!query) {
                        response.status(400).json({
                            success: false,
                            message: "Invalid facility ID",
                        });
                        return;
                    }

                    const facility = await facilitiesCollection.findOne(query);
                    if (!facility) {
                        response.status(404).json({
                            success: false,
                            message: "Facility not found",
                        });
                        return;
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

        app.get(
            "/api/my-facilities",
            requireUser,
            async (request, response) => {
                try {
                    const facilities = await facilitiesCollection
                        .find({ owner_email: request.user.email })
                        .sort({ createdAt: -1 })
                        .toArray();
                    response.status(200).json(facilities);
                } catch (error) {
                    console.error("Failed to load owned facilities:", error);
                    response.status(500).json({
                        success: false,
                        message: "Failed to load your facilities",
                    });
                }
            }
        );

        function facilityPayload(body, ownerEmail) {
            return {
                name: cleanText(body.name),
                facility_type: cleanText(
                    body.facility_type || body.sportType
                ),
                image: cleanText(body.image),
                location: cleanText(body.location),
                description: cleanText(body.description),
                price_per_hour: Number(
                    body.price_per_hour ?? body.pricePerHour
                ),
                capacity: Number(body.capacity),
                available_slots: normalizeSlots(body.available_slots),
                owner_email: ownerEmail,
            };
        }

        function validateFacility(facility) {
            const requiredText = [
                "name",
                "facility_type",
                "image",
                "location",
                "description",
            ];
            const missing = requiredText.filter(
                (field) => !facility[field]
            );

            if (missing.length) return `Missing fields: ${missing.join(", ")}`;
            if (
                !Number.isFinite(facility.price_per_hour) ||
                facility.price_per_hour <= 0
            ) {
                return "Price per hour must be greater than zero";
            }
            if (
                !Number.isInteger(facility.capacity) ||
                facility.capacity <= 0
            ) {
                return "Capacity must be a positive whole number";
            }
            if (!facility.available_slots.length) {
                return "Add at least one available time slot";
            }
            return "";
        }

        app.post(
            "/api/facilities",
            requireUser,
            async (request, response) => {
                try {
                    const facility = facilityPayload(
                        request.body,
                        request.user.email
                    );
                    const validationError = validateFacility(facility);

                    if (validationError) {
                        response.status(400).json({
                            success: false,
                            message: validationError,
                        });
                        return;
                    }

                    const now = new Date();
                    const result = await facilitiesCollection.insertOne({
                        ...facility,
                        booking_count: 0,
                        createdAt: now,
                        updatedAt: now,
                    });
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
            }
        );

        app.put(
            "/api/facilities/:id",
            requireUser,
            async (request, response) => {
                try {
                    const query = objectIdQuery(request.params.id);
                    if (!query) {
                        response.status(400).json({
                            success: false,
                            message: "Invalid facility ID",
                        });
                        return;
                    }

                    const facility = facilityPayload(
                        request.body,
                        request.user.email
                    );
                    const validationError = validateFacility(facility);
                    if (validationError) {
                        response.status(400).json({
                            success: false,
                            message: validationError,
                        });
                        return;
                    }

                    const result = await facilitiesCollection.updateOne(
                        { ...query, owner_email: request.user.email },
                        { $set: { ...facility, updatedAt: new Date() } }
                    );

                    if (!result.matchedCount) {
                        response.status(404).json({
                            success: false,
                            message:
                                "Facility not found or you are not its owner",
                        });
                        return;
                    }

                    response.status(200).json({
                        success: true,
                        message: "Facility updated successfully",
                    });
                } catch (error) {
                    console.error("Failed to update facility:", error);
                    response.status(500).json({
                        success: false,
                        message: "Failed to update facility",
                    });
                }
            }
        );

        app.delete(
            "/api/facilities/:id",
            requireUser,
            async (request, response) => {
                try {
                    const query = objectIdQuery(request.params.id);
                    if (!query) {
                        response.status(400).json({
                            success: false,
                            message: "Invalid facility ID",
                        });
                        return;
                    }

                    const result = await facilitiesCollection.deleteOne({
                        ...query,
                        owner_email: request.user.email,
                    });
                    if (!result.deletedCount) {
                        response.status(404).json({
                            success: false,
                            message:
                                "Facility not found or you are not its owner",
                        });
                        return;
                    }

                    await bookingsCollection.deleteMany({
                        facility_id: request.params.id,
                    });
                    response.status(200).json({
                        success: true,
                        message: "Facility deleted successfully",
                    });
                } catch (error) {
                    console.error("Failed to delete facility:", error);
                    response.status(500).json({
                        success: false,
                        message: "Failed to delete facility",
                    });
                }
            }
        );

        app.post(
            "/api/bookings",
            requireUser,
            async (request, response) => {
                try {
                    const facilityQuery = objectIdQuery(
                        request.body.facilityId
                    );
                    if (!facilityQuery) {
                        response.status(400).json({
                            success: false,
                            message: "Invalid facility ID",
                        });
                        return;
                    }

                    const facility = await facilitiesCollection.findOne(
                        facilityQuery
                    );
                    if (!facility) {
                        response.status(404).json({
                            success: false,
                            message: "Facility not found",
                        });
                        return;
                    }

                    const bookingDate = cleanText(request.body.bookingDate);
                    const timeSlot = cleanText(request.body.timeSlot);
                    const hours = Number(request.body.hours);
                    const parsedDate = new Date(`${bookingDate}T00:00:00`);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    if (
                        !bookingDate ||
                        Number.isNaN(parsedDate.getTime()) ||
                        parsedDate < today
                    ) {
                        response.status(400).json({
                            success: false,
                            message: "Choose a valid date",
                        });
                        return;
                    }
                    if (!facility.available_slots?.includes(timeSlot)) {
                        response.status(400).json({
                            success: false,
                            message: "Choose an available time slot",
                        });
                        return;
                    }
                    if (!Number.isInteger(hours) || hours < 1 || hours > 8) {
                        response.status(400).json({
                            success: false,
                            message: "Booking hours must be between 1 and 8",
                        });
                        return;
                    }

                    const duplicate = await bookingsCollection.findOne({
                        facility_id: String(facility._id),
                        booking_date: bookingDate,
                        time_slot: timeSlot,
                    });
                    if (duplicate) {
                        response.status(409).json({
                            success: false,
                            message:
                                "This time slot is already booked for the selected date",
                        });
                        return;
                    }

                    const booking = {
                        facility_id: String(facility._id),
                        facility_name: facility.name,
                        facility_image: facility.image,
                        facility_location: facility.location,
                        facility_type: facility.facility_type,
                        booking_date: bookingDate,
                        time_slot: timeSlot,
                        hours,
                        price_per_hour: Number(facility.price_per_hour),
                        total_price:
                            Number(facility.price_per_hour) * hours,
                        user_email: request.user.email,
                        user_name: request.user.name,
                        owner_email: facility.owner_email || "",
                        status: "pending",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    const result = await bookingsCollection.insertOne(booking);
                    await facilitiesCollection.updateOne(facilityQuery, {
                        $inc: { booking_count: 1 },
                    });

                    response.status(201).json({
                        success: true,
                        message: "Booking placed successfully",
                        insertedId: result.insertedId,
                    });
                } catch (error) {
                    console.error("Failed to create booking:", error);
                    response.status(500).json({
                        success: false,
                        message: "Failed to place booking",
                    });
                }
            }
        );

        app.get(
            "/api/my-bookings",
            requireUser,
            async (request, response) => {
                try {
                    const bookings = await bookingsCollection
                        .find({ user_email: request.user.email })
                        .sort({ createdAt: -1 })
                        .toArray();
                    response.status(200).json(bookings);
                } catch (error) {
                    console.error("Failed to load bookings:", error);
                    response.status(500).json({
                        success: false,
                        message: "Failed to load your bookings",
                    });
                }
            }
        );

        app.delete(
            "/api/bookings/:id",
            requireUser,
            async (request, response) => {
                try {
                    const query = objectIdQuery(request.params.id);
                    if (!query) {
                        response.status(400).json({
                            success: false,
                            message: "Invalid booking ID",
                        });
                        return;
                    }

                    const booking = await bookingsCollection.findOne({
                        ...query,
                        user_email: request.user.email,
                    });
                    if (!booking) {
                        response.status(404).json({
                            success: false,
                            message:
                                "Booking not found or it does not belong to you",
                        });
                        return;
                    }

                    await bookingsCollection.deleteOne({ _id: booking._id });
                    if (ObjectId.isValid(booking.facility_id)) {
                        await facilitiesCollection.updateOne(
                            { _id: new ObjectId(booking.facility_id) },
                            { $inc: { booking_count: -1 } }
                        );
                    }
                    response.status(200).json({
                        success: true,
                        message: "Booking cancelled successfully",
                    });
                } catch (error) {
                    console.error("Failed to cancel booking:", error);
                    response.status(500).json({
                        success: false,
                        message: "Failed to cancel booking",
                    });
                }
            }
        );

        app.use((error, _request, response, _next) => {
            console.error("Unhandled server error:", error);
            response.status(500).json({
                success: false,
                message: "Unexpected server error",
            });
        });

        app.listen(port, () => {
            console.log("MongoDB connected successfully");
            console.log(
                `PlayGrid server is running on http://localhost:${port}`
            );
        });
    } catch (error) {
        console.error("Failed to start PlayGrid server:", error.message);
        process.exit(1);
    }
}

startServer();

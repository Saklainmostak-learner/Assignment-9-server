import crypto from "node:crypto";

const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

function encode(value) {
    return Buffer.from(value).toString("base64url");
}

function sign(value, secret) {
    return crypto
        .createHmac("sha256", secret)
        .update(value)
        .digest("base64url");
}

function getSecret() {
    const secret =
        process.env.JWT_SECRET || process.env.BETTER_AUTH_SECRET;

    if (!secret) {
        throw new Error("JWT_SECRET or BETTER_AUTH_SECRET is required");
    }

    return secret;
}

export function createAccessToken(user) {
    const now = Math.floor(Date.now() / 1000);
    const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = encode(
        JSON.stringify({
            sub: user.id,
            email: user.email,
            name: user.name || "",
            iat: now,
            exp: now + TOKEN_LIFETIME_SECONDS,
        })
    );
    const body = `${header}.${payload}`;

    return `${body}.${sign(body, getSecret())}`;
}

export function verifyAccessToken(token) {
    if (!token) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const body = `${header}.${payload}`;
    const expectedSignature = sign(body, getSecret());
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
        providedBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
        return null;
    }

    try {
        const decoded = JSON.parse(
            Buffer.from(payload, "base64url").toString("utf8")
        );

        if (
            !decoded.email ||
            !decoded.exp ||
            decoded.exp <= Math.floor(Date.now() / 1000)
        ) {
            return null;
        }

        return decoded;
    } catch {
        return null;
    }
}

export function readCookie(request, name) {
    const cookieHeader = request.headers.cookie || "";

    for (const cookie of cookieHeader.split(";")) {
        const [key, ...valueParts] = cookie.trim().split("=");
        if (key === name) {
            return decodeURIComponent(valueParts.join("="));
        }
    }

    return "";
}

export function accessCookie(token) {
    const secure = process.env.NODE_ENV === "production";
    const attributes = [
        `playgrid_access_token=${encodeURIComponent(token)}`,
        "HttpOnly",
        "Path=/",
        `Max-Age=${TOKEN_LIFETIME_SECONDS}`,
        `SameSite=${secure ? "None" : "Lax"}`,
    ];

    if (secure) attributes.push("Secure");
    return attributes.join("; ");
}

export function clearAccessCookie() {
    const secure = process.env.NODE_ENV === "production";
    const attributes = [
        "playgrid_access_token=",
        "HttpOnly",
        "Path=/",
        "Max-Age=0",
        `SameSite=${secure ? "None" : "Lax"}`,
    ];

    if (secure) attributes.push("Secure");
    return attributes.join("; ");
}

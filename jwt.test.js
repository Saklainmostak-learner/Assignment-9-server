import assert from "node:assert/strict";
import test from "node:test";
import {
    accessCookie,
    clearAccessCookie,
    createAccessToken,
    verifyAccessToken,
} from "./jwt.js";

process.env.JWT_SECRET = "playgrid-test-secret-that-is-not-used-in-production";

test("creates and verifies a signed user token", () => {
    const token = createAccessToken({
        id: "user-1",
        email: "player@example.com",
        name: "Player One",
    });
    const user = verifyAccessToken(token);

    assert.equal(user.sub, "user-1");
    assert.equal(user.email, "player@example.com");
});

test("rejects a changed token", () => {
    const token = createAccessToken({
        id: "user-1",
        email: "player@example.com",
        name: "Player One",
    });

    assert.equal(verifyAccessToken(`${token}changed`), null);
});

test("uses HTTPOnly cookie attributes", () => {
    assert.match(accessCookie("token"), /HttpOnly/);
    assert.match(accessCookie("token"), /SameSite=Lax/);
    assert.match(clearAccessCookie(), /Max-Age=0/);
});

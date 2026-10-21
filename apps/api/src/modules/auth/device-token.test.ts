import { describe, expect, it } from "vitest";
import { mayReceiveDeviceToken } from "./device-token";

const app = { "x-ledgerline-client": "android" };
const signIn = "/api/v1/auth/sign-in/email";

describe("mayReceiveDeviceToken", () => {
  it("gives the token to the app on sign-in and the code checks", () => {
    expect(mayReceiveDeviceToken(app, "POST", signIn)).toBe(true);
    expect(
      mayReceiveDeviceToken(app, "POST", "/api/v1/auth/two-factor/verify-totp"),
    ).toBe(true);
    expect(
      mayReceiveDeviceToken(
        app,
        "POST",
        "/api/v1/auth/two-factor/verify-backup-code",
      ),
    ).toBe(true);
  });

  it("gives it to the app on a request that already carries a bearer token", () => {
    expect(
      mayReceiveDeviceToken(
        { ...app, authorization: "Bearer abc.def" },
        "GET",
        "/api/v1/auth/get-session",
      ),
    ).toBe(true);
  });

  it("never gives it to a browser, or to the app on any other request", () => {
    expect(mayReceiveDeviceToken({}, "POST", signIn)).toBe(false);
    expect(
      mayReceiveDeviceToken(
        { origin: "http://localhost:5173" },
        "POST",
        signIn,
      ),
    ).toBe(false);
    expect(mayReceiveDeviceToken(app, "GET", "/api/v1/auth/get-session")).toBe(
      false,
    );
    expect(
      mayReceiveDeviceToken(app, "POST", "/api/v1/auth/two-factor/enable"),
    ).toBe(false);
    expect(
      mayReceiveDeviceToken(
        { ...app, authorization: "Bearer " },
        "GET",
        "/api/v1/auth/get-session",
      ),
    ).toBe(false);
    expect(
      mayReceiveDeviceToken(
        { "x-ledgerline-client": "web", authorization: "Bearer x" },
        "GET",
        "/api/v1/auth/get-session",
      ),
    ).toBe(false);
  });
});

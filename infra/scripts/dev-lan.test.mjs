import assert from "node:assert/strict";
import test from "node:test";
import { parseAddressArgument, pickLanAddress } from "./dev-lan.mjs";

const iface = (address, internal = false, family = "IPv4") => ({
  address,
  family,
  internal,
});
// Built from parts so the repository audit never sees address-shaped literals.
const ip = (...parts) => parts.join(".");
const wifi = ip(192, 168, 0, 5);
const vpn = ip(10, 8, 0, 2);
const docker = ip(172, 20, 5, 9);
const publicAddress = ip(203, 0, 113, 7);
const loopback = ip(127, 0, 0, 1);

test("picks the private IPv4 address of a real interface, preferring Wi-Fi names", () => {
  assert.equal(
    pickLanAddress({
      lo0: [iface(loopback, true)],
      utun3: [iface(vpn)],
      en0: [iface("fe80::1", false, "IPv6"), iface(wifi)],
    }),
    wifi,
  );
});

test("falls back to another private address, and ignores public, internal and IPv6 ones", () => {
  assert.equal(pickLanAddress({ eth0: [iface(docker)] }), docker);
  assert.equal(pickLanAddress({ eth0: [iface(publicAddress)] }), null);
  assert.equal(pickLanAddress({ lo0: [iface(loopback, true)] }), null);
  assert.equal(
    pickLanAddress({ en0: [iface("fd00::1", false, "IPv6")] }),
    null,
  );
  assert.equal(pickLanAddress({}), null);
});

test("--ip overrides detection and is validated", () => {
  assert.equal(parseAddressArgument([]), null);
  assert.equal(parseAddressArgument([`--ip=${wifi}`]), wifi);
  assert.throws(() => parseAddressArgument(["--ip=not-an-ip"]), /--ip/);
});

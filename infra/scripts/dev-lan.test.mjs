import assert from "node:assert/strict";
import test from "node:test";
import { parseAddressArgument, pickLanAddress } from "./dev-lan.mjs";

const iface = (address, internal = false, family = "IPv4") => ({
  address,
  family,
  internal,
});

test("picks the private IPv4 address of a real interface, preferring Wi-Fi names", () => {
  assert.equal(
    pickLanAddress({
      lo0: [iface("127.0.0.1", true)],
      utun3: [iface("10.8.0.2")],
      en0: [iface("fe80::1", false, "IPv6"), iface("192.168.0.226")],
    }),
    "192.168.0.226",
  );
});

test("falls back to another private address, and ignores public, internal and IPv6 ones", () => {
  assert.equal(pickLanAddress({ eth0: [iface("172.20.5.9")] }), "172.20.5.9");
  assert.equal(pickLanAddress({ eth0: [iface("203.0.113.7")] }), null);
  assert.equal(pickLanAddress({ lo0: [iface("127.0.0.1", true)] }), null);
  assert.equal(
    pickLanAddress({ en0: [iface("fd00::1", false, "IPv6")] }),
    null,
  );
  assert.equal(pickLanAddress({}), null);
});

test("--ip overrides detection and is validated", () => {
  assert.equal(parseAddressArgument([]), null);
  assert.equal(parseAddressArgument(["--ip=192.168.1.20"]), "192.168.1.20");
  assert.throws(() => parseAddressArgument(["--ip=not-an-ip"]), /--ip/);
});

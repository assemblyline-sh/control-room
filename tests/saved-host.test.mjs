import assert from "node:assert/strict";
import { test } from "node:test";
import { computerOf, savedHostFor } from "../src/lib/saved-host.js";

const hosts = [
  { name: "local", is_local: true, ssh: null },
  { name: "alexs-mbp-16", is_local: false, ssh: "alexs-mbp-16" },
  { name: "build-box", is_local: false, ssh: "deploy@build-box" },
];

test("the computer drops the user", () => {
  assert.equal(computerOf("alex@alexs-mbp-16"), "alexs-mbp-16");
  assert.equal(computerOf("alexs-mbp-16"), "alexs-mbp-16");
});

test("a saved host is found by its ssh value or name", () => {
  assert.equal(savedHostFor(hosts, "alexs-mbp-16"), "alexs-mbp-16");
  assert.equal(savedHostFor(hosts, "deploy@build-box"), "build-box");
  assert.equal(savedHostFor(hosts, " build-box "), "build-box");
});

test("user@ on either side is the same computer", () => {
  // What failed on s0179: typed alex@alexs-mbp-16, saved as plain alexs-mbp-16.
  assert.equal(savedHostFor(hosts, "alex@alexs-mbp-16"), "alexs-mbp-16");
  assert.equal(savedHostFor(hosts, "other@build-box"), "build-box");
});

test("this computer and unknown names aren't saved hosts", () => {
  assert.equal(savedHostFor(hosts, "local"), null);
  assert.equal(savedHostFor(hosts, "new-box"), null);
  assert.equal(savedHostFor(hosts, ""), null);
});

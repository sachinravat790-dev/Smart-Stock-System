import assert from "node:assert/strict";
import test from "node:test";
import {
  isUuid,
  validateLocation,
  validateLocationFilters,
} from "../src/location-validation.js";

test("location validation trims and accepts required rack and shelf codes", () => {
  assert.deepEqual(validateLocation({ rack_code: " R04 ", shelf_code: " S02 " }), {
    valid: true,
    location: { rack_code: "R04", shelf_code: "S02", location_photo: null },
  });
});

test("rack and shelf codes are required and bounded", () => {
  for (const body of [
    { rack_code: "", shelf_code: "S02" },
    { rack_code: "R04", shelf_code: "  " },
    { rack_code: "R".repeat(81), shelf_code: "S02" },
    { rack_code: "R\u0000", shelf_code: "S02" },
  ]) {
    assert.equal(validateLocation(body).valid, false);
  }
});

test("location photo accepts public HTTP URLs and rejects unsafe or malformed URLs", () => {
  assert.equal(
    validateLocation({
      rack_code: "R04",
      shelf_code: "S02",
      location_photo: "https://example.test/rack.jpg",
    }).valid,
    true,
  );
  for (const location_photo of [
    "javascript:alert(1)",
    "file:///tmp/photo.jpg",
    "https://user:password@example.test/photo.jpg",
    "https://example.test/with space.jpg",
    `https://example.test/${"a".repeat(2048)}`,
  ]) {
    assert.equal(
      validateLocation({ rack_code: "R04", shelf_code: "S02", location_photo }).valid,
      false,
    );
  }
});

test("location filters validate text values and allow optional empty filters", () => {
  assert.deepEqual(validateLocationFilters({ rack: "", shelf: "S02" }), {
    valid: true,
    filters: { search: "", rack: "", shelf: "S02" },
  });
  assert.equal(validateLocationFilters({ search: "x".repeat(161) }).valid, false);
  assert.equal(validateLocationFilters({ rack: ["R04"] }).valid, false);
});

test("product IDs use UUID validation", () => {
  assert.equal(isUuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8"), true);
  assert.equal(isUuid("not-a-uuid"), false);
});

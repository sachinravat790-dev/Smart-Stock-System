import assert from "node:assert/strict";
import test from "node:test";
import { ownerSections, sectionForRole, staffSections } from "../src/access.js";

test("Owner navigation includes the required Owner areas", () => {
  assert.deepEqual(
    ownerSections.map(({ label }) => label),
    [
      "Dashboard",
      "Inventory",
      "Receive Stock",
      "Sales",
      "Find Product",
      "Expiry",
      "Audit",
      "Payments",
      "Staff Activity",
      "Reports",
      "AI Assistant",
    ],
  );
});

test("Staff navigation is limited to the required Staff areas", () => {
  assert.deepEqual(
    staffSections.map(({ label }) => label),
    ["Quick Sale", "Receive Stock", "Find Product"],
  );
});

test("Owner-only areas are rejected by Staff authorization", () => {
  for (const section of [
    "dashboard",
    "inventory",
    "sales",
    "expiry",
    "audit",
    "payments",
    "staff-activity",
    "reports",
    "ai-assistant",
  ]) {
    assert.equal(sectionForRole(section, "staff"), undefined, section);
    assert.ok(sectionForRole(section, "owner"), section);
  }
});

test("Receive Stock and Find Product are shared while Quick Sale is Staff-only", () => {
  assert.ok(sectionForRole("receive-stock", "owner"));
  assert.ok(sectionForRole("receive-stock", "staff"));
  assert.ok(sectionForRole("find-product", "owner"));
  assert.ok(sectionForRole("find-product", "staff"));
  assert.ok(sectionForRole("quick-sale", "staff"));
  assert.equal(sectionForRole("quick-sale", "owner"), undefined);
});

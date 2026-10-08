export const ownerSections = [
  { id: "dashboard", label: "Dashboard" },
  { id: "inventory", label: "Inventory" },
  { id: "receive-stock", label: "Receive Stock" },
  { id: "sales", label: "Sales" },
  { id: "find-product", label: "Find Product" },
  { id: "expiry", label: "Expiry" },
  { id: "audit", label: "Audit" },
  { id: "payments", label: "Payments" },
  { id: "staff-activity", label: "Staff Activity" },
  { id: "reports", label: "Reports" },
  { id: "ai-assistant", label: "AI Assistant" },
];

export const staffSections = [
  { id: "quick-sale", label: "Quick Sale" },
  { id: "receive-stock", label: "Receive Stock" },
  { id: "find-product", label: "Find Product" },
];

export function sectionForRole(sectionId, role) {
  const sections = role === "owner" ? ownerSections : staffSections;
  return sections.find((section) => section.id === sectionId);
}

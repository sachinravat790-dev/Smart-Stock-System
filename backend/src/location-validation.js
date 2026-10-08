export function validateLocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("Location details are required.");
  }

  const rackCode = requiredCode(value.rack_code);
  if (!rackCode) return invalid("Rack code is required (maximum 80 characters).");

  const shelfCode = requiredCode(value.shelf_code);
  if (!shelfCode) return invalid("Shelf code is required (maximum 80 characters).");

  const locationPhoto = optionalImageUrl(value.location_photo);
  if (locationPhoto === false) {
    return invalid("Location photo must be an HTTP or HTTPS URL up to 2048 characters.");
  }

  return {
    valid: true,
    location: {
      rack_code: rackCode,
      shelf_code: shelfCode,
      location_photo: locationPhoto,
    },
  };
}

export function validateLocationFilters(query) {
  const search = optionalFilter(query.search, 160);
  if (search === false) return invalid("Search must be at most 160 characters.");

  const rack = optionalFilter(query.rack, 80);
  if (rack === false) return invalid("Rack filter must be at most 80 characters.");

  const shelf = optionalFilter(query.shelf, 80);
  if (shelf === false) return invalid("Shelf filter must be at most 80 characters.");

  return { valid: true, filters: { search, rack, shelf } };
}

export function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requiredCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function optionalImageUrl(value) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !/^https?:\/\/[^\s]+$/i.test(value)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return value;
}

function optionalFilter(value, maximum) {
  if (value === undefined) return "";
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return false;
  }
  return normalized;
}

function invalid(error) {
  return { valid: false, error };
}

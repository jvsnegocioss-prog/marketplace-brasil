const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUANTITY = 2_147_483_647;

function normalizeCheckoutItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return { ok: false, items: [] };
  }

  const quantities = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, items: [] };
    }

    if (typeof item.id !== "string" || !UUID_PATTERN.test(item.id)) {
      return { ok: false, items: [] };
    }

    if (!Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > MAX_QUANTITY) {
      return { ok: false, items: [] };
    }

    const id = item.id.toLowerCase();
    const combined = (quantities.get(id) ?? 0) + item.qty;
    if (!Number.isSafeInteger(combined) || combined > MAX_QUANTITY) {
      return { ok: false, items: [] };
    }
    quantities.set(id, combined);
  }

  return {
    ok: true,
    items: Array.from(quantities, ([id, qty]) => ({ id, qty })),
  };
}

module.exports = { normalizeCheckoutItems };

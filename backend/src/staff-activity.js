const actionTypes = new Set([
  "LOGIN",
  "LOGOUT",
  "RECEIVE_STOCK",
  "ADD_PRODUCT",
  "UPDATE_PRODUCT",
  "MOVE_PRODUCT",
  "SALE",
  "STOCK_AUDIT",
  "PAYMENT_RECONCILIATION",
]);

export async function recordStaffActivity(
  client,
  {
    userId,
    actionType,
    productId = null,
    quantity = null,
    referenceType = null,
    referenceId = null,
    metadata = {},
  },
) {
  if (!actionTypes.has(actionType)) {
    throw new TypeError("Unsupported internal staff activity type.");
  }
  if (!userId || typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new TypeError("Invalid internal staff activity data.");
  }
  const serializedMetadata = JSON.stringify(metadata);
  if (Buffer.byteLength(serializedMetadata) > 8192) {
    throw new RangeError("Staff activity metadata exceeds its storage limit.");
  }

  await client.query(
    `INSERT INTO public.staff_activities (
       user_id, action_type, product_id, quantity,
       reference_type, reference_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      userId,
      actionType,
      productId,
      quantity,
      referenceType,
      referenceId === null ? null : String(referenceId),
      serializedMetadata,
    ],
  );
}

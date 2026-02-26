/**
 * Schema utilities for type handling and coercion in workflow components.
 */

/**
 * Extract the primary (non-null) type from a JSON schema field definition.
 */
export function extractPrimaryTypeFromSchema(
  fieldSchema: Record<string, unknown>
): string {
  if ("type" in fieldSchema && typeof fieldSchema.type === "string") {
    return fieldSchema.type;
  }

  if ("anyOf" in fieldSchema && Array.isArray(fieldSchema.anyOf)) {
    for (const typeOption of fieldSchema.anyOf) {
      if (
        typeof typeOption === "object" &&
        typeOption !== null &&
        "type" in typeOption &&
        (typeOption as Record<string, unknown>).type !== "null"
      ) {
        return ((typeOption as Record<string, unknown>).type as string) ?? "string";
      }
    }
  }

  return "string";
}

/**
 * Coerce a value to match the expected type based on a JSON schema.
 */
export function coerceValueToSchemaType(
  value: unknown,
  fieldName: string,
  modelSchema: Record<string, unknown>
): unknown {
  if (value === null || value === undefined) return value;

  const properties = (modelSchema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const fieldSchema = properties[fieldName];
  if (!fieldSchema) return value;

  const targetType = extractPrimaryTypeFromSchema(fieldSchema);

  try {
    if (targetType === "integer" && (typeof value === "number" || typeof value === "string")) {
      if (typeof value === "string" && /^\d+$/.test(value)) return parseInt(value, 10);
      if (typeof value === "number") return Math.trunc(value);
    }

    if (targetType === "number" && (typeof value === "number" || typeof value === "string")) {
      if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return parseFloat(value);
      if (typeof value === "number") return value;
    }

    if (targetType === "string" && typeof value !== "string") {
      return String(value);
    }

    if (targetType === "boolean") {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.toLowerCase());
      if (typeof value === "number") return Boolean(value);
    }

    if (targetType === "object" && typeof value === "object") return value;
    if (targetType === "array" && Array.isArray(value)) return value;
  } catch {
    // If coercion fails, return original value
  }

  return value;
}

/**
 * Map JSON schema type strings to a description string.
 */
export function getPythonTypeFromJsonSchemaType(
  jsonType: string
): string {
  const typeMap: Record<string, string> = {
    string: "string",
    integer: "number",
    number: "number",
    boolean: "boolean",
    array: "array",
    object: "object",
  };
  return typeMap[jsonType] ?? "string";
}

import { invoke } from "@tauri-apps/api/core";
import { geocodioPropertyKey } from "./addressCheck";
import { isTauriRuntime } from "./env";
import type { GeocodioLookupRequest, GeocodioLookupResult } from "./types";

function mapGeocodioBody(body: unknown): GeocodioLookupResult {
  if (!body || typeof body !== "object") {
    return { status: "fail", message: "No matching address." };
  }
  const record = body as Record<string, unknown>;
  const results = Array.isArray(record.results) ? record.results : [];
  const first = results[0];
  if (!first || typeof first !== "object") {
    return { status: "fail", message: "No matching address." };
  }
  const item = first as Record<string, unknown>;
  const accuracy = typeof item.accuracy === "number" ? item.accuracy : undefined;
  const accuracyType = typeof item.accuracy_type === "string" ? item.accuracy_type : undefined;
  const matchedAddress = typeof item.formatted_address === "string" ? item.formatted_address : undefined;
  const components =
    item.address_components && typeof item.address_components === "object"
      ? (item.address_components as Record<string, unknown>)
      : undefined;
  const propertyKey = geocodioPropertyKey(components);
  const fields = item.fields && typeof item.fields === "object" ? (item.fields as Record<string, unknown>) : undefined;
  const zip4 = fields?.zip4 && typeof fields.zip4 === "object" ? (fields.zip4 as Record<string, unknown>) : undefined;
  const exactMatch = typeof zip4?.exact_match === "boolean" ? zip4.exact_match : undefined;
  const validDeliveryArea = typeof zip4?.valid_delivery_area === "boolean" ? zip4.valid_delivery_area : undefined;

  if (exactMatch === true) {
    return { status: "pass", exactMatch, accuracy, accuracyType, matchedAddress, propertyKey };
  }
  if (validDeliveryArea === false) {
    return {
      status: "fail",
      exactMatch,
      accuracy,
      accuracyType,
      matchedAddress,
      propertyKey,
      message: "Address is not a valid USPS delivery point.",
    };
  }
  if (zip4 || (accuracy ?? 0) >= 0.8) {
    return {
      status: "warn",
      exactMatch: exactMatch ?? false,
      accuracy,
      accuracyType,
      matchedAddress,
      propertyKey,
      message:
        exactMatch === false
          ? "Street matched, but the unit is not an exact USPS ZIP+4 match."
          : "Address geocoded, but not an exact USPS ZIP+4 match.",
    };
  }
  return {
    status: "fail",
    exactMatch,
    accuracy,
    accuracyType,
    matchedAddress,
    propertyKey,
    message: "Address did not match a deliverable USPS record.",
  };
}

function lookupErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  const nested = record.error;
  if (nested && typeof nested === "object" && "message" in nested) {
    const message = (nested as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export async function geocodioLookup(request: GeocodioLookupRequest): Promise<GeocodioLookupResult> {
  const apiKey = request.apiKey.trim();
  if (!apiKey) {
    throw new Error("Add a Geocodio API key first.");
  }

  if (isTauriRuntime()) {
    return invoke<GeocodioLookupResult>("geocodio_lookup", { request });
  }

  const response = await fetch("/__geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(lookupErrorMessage(body, "Geocodio request failed."));
  }
  return mapGeocodioBody(body);
}

export async function testGeocodioConnection(apiKey: string): Promise<string> {
  const result = await geocodioLookup({
    apiKey,
    street: "1600 Amphitheatre Parkway",
    city: "Mountain View",
    state: "CA",
    postalCode: "94043",
  });
  if (result.status === "error") {
    throw new Error(result.message || "Geocodio test failed.");
  }
  return "Geocodio connection works.";
}

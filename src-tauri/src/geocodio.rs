use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const GEOCODIO_URL: &str = "https://api.geocod.io/v2/geocode";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodioLookupRequest {
    pub api_key: String,
    pub street: String,
    pub unit: Option<String>,
    pub city: String,
    pub state: String,
    pub postal_code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodioLookupResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exact_match: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accuracy: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accuracy_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub property_key: Option<String>,
}

fn sanitize_error(message: impl std::fmt::Display) -> String {
    let raw = message.to_string();
    if let Some(index) = raw.find("api_key=") {
        let end = raw[index..]
            .find(|ch: char| ch == '&' || ch == ' ' || ch == '"' || ch == '\'')
            .map(|offset| index + offset)
            .unwrap_or(raw.len());
        return format!("{}api_key=***{}", &raw[..index], &raw[end..]);
    }
    raw
}

fn text_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn property_key(first: &Value) -> Option<String> {
    let components = first.get("address_components")?;
    let number = text_field(components, "number");
    let mut street = text_field(components, "formatted_street");
    if street.is_empty() {
        street = [text_field(components, "predirectional"), text_field(components, "street"), text_field(components, "suffix")]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
    }
    let city = text_field(components, "city");
    let mut state = text_field(components, "state_province");
    if state.is_empty() {
        state = text_field(components, "state");
    }
    let mut zip = text_field(components, "postal_code");
    if zip.is_empty() {
        zip = text_field(components, "zip");
    }
    let zip5: String = zip.chars().filter(|ch| ch.is_ascii_digit()).take(5).collect();
    if number.is_empty() && street.is_empty() {
        return None;
    }
    Some(
        format!("{number}|{street}|{city}|{state}|{zip5}")
            .to_ascii_lowercase(),
    )
}

fn with_match(mut result: GeocodioLookupResult, first: &Value) -> GeocodioLookupResult {
    result.matched_address = first
        .get("formatted_address")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    result.property_key = property_key(first);
    result
}

fn map_result(body: &Value) -> GeocodioLookupResult {
    let results = body.get("results").and_then(Value::as_array);
    let Some(first) = results.and_then(|items| items.first()) else {
        return GeocodioLookupResult {
            status: "fail".into(),
            exact_match: None,
            accuracy: None,
            accuracy_type: None,
            message: Some("No matching address.".into()),
            matched_address: None,
            property_key: None,
        };
    };

    let accuracy = first.get("accuracy").and_then(Value::as_f64);
    let accuracy_type = first
        .get("accuracy_type")
        .and_then(Value::as_str)
        .map(str::to_string);
    let zip4 = first.pointer("/fields/zip4");
    let exact_match = zip4.and_then(|value| value.get("exact_match")).and_then(Value::as_bool);
    let valid_delivery_area = zip4
        .and_then(|value| value.get("valid_delivery_area"))
        .and_then(Value::as_bool);

    if exact_match == Some(true) {
        return with_match(
            GeocodioLookupResult {
                status: "pass".into(),
                exact_match,
                accuracy,
                accuracy_type,
                message: None,
                matched_address: None,
                property_key: None,
            },
            first,
        );
    }

    if valid_delivery_area == Some(false) {
        return with_match(
            GeocodioLookupResult {
                status: "fail".into(),
                exact_match,
                accuracy,
                accuracy_type,
                message: Some("Address is not a valid USPS delivery point.".into()),
                matched_address: None,
                property_key: None,
            },
            first,
        );
    }

    if zip4.is_some() || accuracy.unwrap_or(0.0) >= 0.8 {
        return with_match(
            GeocodioLookupResult {
                status: "warn".into(),
                exact_match: exact_match.or(Some(false)),
                accuracy,
                accuracy_type,
                message: Some(
                    if exact_match == Some(false) {
                        "Street matched, but the unit is not an exact USPS ZIP+4 match."
                    } else {
                        "Address geocoded, but not an exact USPS ZIP+4 match."
                    }
                    .into(),
                ),
                matched_address: None,
                property_key: None,
            },
            first,
        );
    }

    with_match(
        GeocodioLookupResult {
            status: "fail".into(),
            exact_match,
            accuracy,
            accuracy_type,
            message: Some("Address did not match a deliverable USPS record.".into()),
            matched_address: None,
            property_key: None,
        },
        first,
    )
}

pub async fn lookup(request: GeocodioLookupRequest) -> Result<GeocodioLookupResult, String> {
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("Add a Geocodio API key first.".into());
    }

    let client = Client::builder()
        .build()
        .map_err(|error| sanitize_error(error))?;
    let street2 = request.unit.as_deref().unwrap_or("").trim();
    let mut query = vec![
        ("api_key", api_key),
        ("street", request.street.trim()),
        ("city", request.city.trim()),
        ("state_province", request.state.trim()),
        ("postal_code", request.postal_code.trim()),
        ("country", "US"),
        ("fields", "zip4"),
        ("limit", "1"),
    ];
    if !street2.is_empty() {
        query.push(("street2", street2));
    }

    let response = client
        .get(GEOCODIO_URL)
        .query(&query)
        .send()
        .await
        .map_err(|error| sanitize_error(error))?;

    let status = response.status();
    let body: Value = response.json().await.map_err(|error| sanitize_error(error))?;
    if !status.is_success() {
        let detail = body
            .get("error")
            .and_then(Value::as_str)
            .or_else(|| body.pointer("/error/message").and_then(Value::as_str))
            .unwrap_or("Geocodio request failed.");
        return Err(sanitize_error(detail));
    }

    Ok(map_result(&body))
}

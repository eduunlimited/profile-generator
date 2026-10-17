#![cfg_attr(debug_assertions, allow(dead_code))]

use serde_json::{json, Map, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const PORT: u16 = 47321;

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("Orders API failed to bind 127.0.0.1:{PORT}: {error}");
                return;
            }
        };
        eprintln!("Orders API http://127.0.0.1:{PORT}/api/orders");
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                continue;
            };
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = handle_client(&app, stream);
            });
        }
    });
}

fn handle_client(app: &AppHandle, mut stream: TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }
    let mut authorization = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("authorization") {
                authorization = value.trim().to_string();
            }
        }
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    if method == "OPTIONS" {
        return write_raw(
            &mut stream,
            204,
            "No Content",
            "",
        );
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if method != "GET" || path != "/api/orders" {
        return write_json(&mut stream, 404, "Not Found", &json!({ "error": "Not found." }));
    }

    let settings = read_store(app, "orders-api.json");
    let enabled = match settings.get("enabled") {
        Some(Value::Bool(value)) => *value,
        Some(Value::String(value)) => value == "true",
        _ => false,
    };
    let token = settings
        .get("token")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if !enabled || token.is_empty() {
        return write_json(
            &mut stream,
            404,
            "Not Found",
            &json!({ "error": "Orders API is disabled." }),
        );
    }
    let presented = bearer_token(&authorization);
    if !tokens_match(presented, &token) {
        return write_json(
            &mut stream,
            401,
            "Unauthorized",
            &json!({ "error": "Missing or invalid API token." }),
        );
    }

    let params = parse_query(query);
    let status = params.get("status").map(String::as_str).unwrap_or("");
    let retailer = params.get("retailer").map(String::as_str).unwrap_or("");
    let id = params.get("id").cloned().unwrap_or_default();
    let since = params.get("since").cloned().unwrap_or_default();
    if !status.is_empty()
        && !matches!(
            status,
            "placed" | "shipped" | "delivered" | "picked_up" | "cancelled" | "manual_cancel"
        )
    {
        return write_json(
            &mut stream,
            400,
            "Bad Request",
            &json!({ "error": "status must be placed, shipped, delivered, picked_up, cancelled, or manual_cancel." }),
        );
    }
    if !retailer.is_empty() && !matches!(retailer, "target" | "walmart" | "pokemon-center") {
        return write_json(
            &mut stream,
            400,
            "Bad Request",
            &json!({ "error": "retailer must be target, walmart, or pokemon-center." }),
        );
    }
    let since_ms = if since.is_empty() {
        None
    } else {
        match parse_time_ms(&since) {
            Some(value) => Some(value),
            None => {
                return write_json(
                    &mut stream,
                    400,
                    "Bad Request",
                    &json!({ "error": "since must be an ISO date or datetime, such as 2026-10-16T00:00:00Z." }),
                );
            }
        }
    };

    let orders = read_store(app, "orders.json");
    let dismissed = read_store(app, "dismissed-orders.json");
    let mut rows: Vec<Value> = orders
        .iter()
        .filter_map(|(key, value)| {
            let object = value.as_object()?;
            let order_id = object.get("id").and_then(|item| item.as_str()).unwrap_or(key);
            if dismissed.contains_key(order_id) {
                return None;
            }
            if !id.is_empty() && order_id != id && object.get("orderId").and_then(|item| item.as_str()) != Some(id.as_str())
            {
                return None;
            }
            if !status.is_empty() && object.get("status").and_then(|item| item.as_str()) != Some(status) {
                return None;
            }
            if !retailer.is_empty() && object.get("retailer").and_then(|item| item.as_str()) != Some(retailer) {
                return None;
            }
            if let Some(since_ms) = since_ms {
                let updated = object
                    .get("updatedAt")
                    .and_then(|item| item.as_str())
                    .and_then(parse_time_ms);
                match updated {
                    Some(value) if value >= since_ms => {}
                    _ => return None,
                }
            }
            Some(public_order(object))
        })
        .collect();
    if !id.is_empty() && rows.is_empty() {
        return write_json(
            &mut stream,
            404,
            "Not Found",
            &json!({ "error": "Order not found." }),
        );
    }
    rows.sort_by(|left, right| {
        let left_ms = left.get("placedAt").and_then(|item| item.as_str()).and_then(parse_time_ms).unwrap_or(0);
        let right_ms = right
            .get("placedAt")
            .and_then(|item| item.as_str())
            .and_then(parse_time_ms)
            .unwrap_or(0);
        right_ms.cmp(&left_ms).then_with(|| {
            let left_id = left.get("orderId").and_then(|item| item.as_str()).unwrap_or("");
            let right_id = right.get("orderId").and_then(|item| item.as_str()).unwrap_or("");
            right_id.cmp(left_id)
        })
    });
    let count = rows.len();
    write_json(
        &mut stream,
        200,
        "OK",
        &json!({
            "exportedAt": chrono_like_now(),
            "count": count,
            "orders": rows,
        }),
    )
}

fn public_order(order: &Map<String, Value>) -> Value {
    let items = order
        .get("items")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let row = item.as_object()?;
                    let name = text(row, "name")?;
                    let quantity = row.get("quantity").and_then(|value| value.as_f64())?;
                    if name.is_empty() || quantity <= 0.0 {
                        return None;
                    }
                    let quantity_json = if quantity.fract() == 0.0 {
                        json!(quantity as u64)
                    } else {
                        json!(quantity)
                    };
                    let mut exported = json!({ "name": name, "quantity": quantity_json });
                    if let Some(price) = row.get("price").and_then(|value| value.as_f64()) {
                        if price > 0.0 {
                            exported["price"] = json!(price);
                        }
                    }
                    Some(exported)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let events = order
        .get("events")
        .and_then(|value| value.as_array())
        .map(|events| {
            events
                .iter()
                .filter_map(|event| {
                    let row = event.as_object()?;
                    let kind = text(row, "kind")?;
                    Some(json!({
                        "kind": kind,
                        "subject": text(row, "subject"),
                        "date": text(row, "date"),
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "id": text(order, "id"),
        "retailer": text(order, "retailer"),
        "orderId": text(order, "orderId"),
        "status": text(order, "status"),
        "fulfillment": text(order, "fulfillment"),
        "total": order.get("total").and_then(|value| value.as_f64()),
        "currency": text(order, "currency"),
        "trackingNumber": text(order, "trackingNumber"),
        "carrier": text(order, "carrier"),
        "expectedDelivery": text(order, "expectedDelivery"),
        "items": items,
        "recipientEmail": text(order, "recipientEmail"),
        "shippingAddress": address(order.get("shippingAddress")),
        "payment": payment(order.get("payment")),
        "profileName": text(order, "profileName"),
        "cancelReason": text(order, "cancelReason"),
        "events": events,
        "placedAt": text(order, "placedAt"),
        "updatedAt": text(order, "updatedAt"),
    })
}

fn address(value: Option<&Value>) -> Value {
    let Some(row) = value.and_then(|item| item.as_object()) else {
        return Value::Null;
    };
    json!({
        "name": text(row, "name"),
        "line1": text(row, "line1"),
        "line2": text(row, "line2"),
        "city": text(row, "city"),
        "state": text(row, "state"),
        "postalCode": text(row, "postalCode"),
        "source": text(row, "source"),
    })
}

fn payment(value: Option<&Value>) -> Value {
    let Some(row) = value.and_then(|item| item.as_object()) else {
        return Value::Null;
    };
    json!({
        "brand": text(row, "brand"),
        "last4": text(row, "last4"),
    })
}

fn text(row: &Map<String, Value>, key: &str) -> Option<String> {
    let value = row.get(key)?.as_str()?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn read_store(app: &AppHandle, file_name: &str) -> Map<String, Value> {
    let Some(path) = store_path(app, file_name) else {
        return Map::new();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return Map::new();
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn store_path(app: &AppHandle, file_name: &str) -> Option<PathBuf> {
    let name = std::path::Path::new(file_name).file_name()?;
    Some(app.path().app_data_dir().ok()?.join(name))
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    let mut params = std::collections::HashMap::new();
    if query.is_empty() {
        return params;
    }
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key.is_empty() {
            continue;
        }
        params.insert(percent_decode(key), percent_decode(value));
    }
    params
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = &value[index + 1..index + 3];
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    index += 3;
                } else {
                    out.push(bytes[index]);
                    index += 1;
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn tokens_match(presented: &str, expected: &str) -> bool {
    let left = presented.as_bytes();
    let right = expected.as_bytes();
    if left.is_empty() || left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn parse_time_ms(value: &str) -> Option<i64> {
    let value = value.trim();
    if value.len() < 10 {
        return None;
    }
    let year: i32 = value.get(0..4)?.parse().ok()?;
    if value.as_bytes().get(4) != Some(&b'-') {
        return None;
    }
    let month: u32 = value.get(5..7)?.parse().ok()?;
    if value.as_bytes().get(7) != Some(&b'-') {
        return None;
    }
    let day: u32 = value.get(8..10)?.parse().ok()?;
    let mut hour = 0u32;
    let mut minute = 0u32;
    let mut second = 0u32;
    let mut millis = 0u32;
    let mut offset_min = 0i32;
    let rest = value.get(10..)?;
    if !rest.is_empty() {
        if !rest.starts_with('T') && !rest.starts_with(' ') {
            return None;
        }
        let time = rest.get(1..)?;
        if time.len() < 8 {
            return None;
        }
        hour = time.get(0..2)?.parse().ok()?;
        if time.as_bytes().get(2) != Some(&b':') {
            return None;
        }
        minute = time.get(3..5)?.parse().ok()?;
        if time.as_bytes().get(5) != Some(&b':') {
            return None;
        }
        second = time.get(6..8)?.parse().ok()?;
        let bytes = time.as_bytes();
        let mut index = 8;
        if bytes.get(index) == Some(&b'.') {
            index += 1;
            let start = index;
            while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
                index += 1;
            }
            let fraction = time.get(start..index)?;
            if fraction.is_empty() {
                return None;
            }
            let digits: String = fraction.chars().take(3).collect();
            let padded = format!("{digits:0<3}");
            millis = padded.parse().ok()?;
        }
        let zone = time.get(index..)?;
        if zone != "Z" {
            let sign = if let Some(stripped) = zone.strip_prefix('+') {
                let _ = stripped;
                1
            } else if let Some(stripped) = zone.strip_prefix('-') {
                let _ = stripped;
                -1
            } else {
                return None;
            };
            let zone_body = &zone[1..];
            let (zone_hour, zone_minute) = if zone_body.len() == 5 && zone_body.as_bytes().get(2) == Some(&b':') {
                (
                    zone_body.get(0..2)?.parse::<i32>().ok()?,
                    zone_body.get(3..5)?.parse::<i32>().ok()?,
                )
            } else if zone_body.len() == 4 {
                (
                    zone_body.get(0..2)?.parse::<i32>().ok()?,
                    zone_body.get(2..4)?.parse::<i32>().ok()?,
                )
            } else {
                return None;
            };
            offset_min = sign * (zone_hour * 60 + zone_minute);
        }
    }
    if hour > 23 || minute > 59 || second > 59 || day > days_in_month(year, month) {
        return None;
    }
    let days = days_from_civil(year, month, day)?;
    let secs = days * 86_400 + i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second)
        - i64::from(offset_min) * 60;
    Some(secs * 1_000 + i64::from(millis))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

fn bearer_token(header: &str) -> &str {
    let mut parts = header.trim().splitn(2, char::is_whitespace);
    let scheme = parts.next().unwrap_or("");
    let token = parts.next().unwrap_or("").trim();
    if scheme.eq_ignore_ascii_case("bearer") {
        token
    } else {
        ""
    }
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = (year - era * 400) as u64;
    let month_prime = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + u64::from(day_of_year);
    Some(i64::from(era) * 146_097 + day_of_era as i64 - 719_468)
}

fn chrono_like_now() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = (seconds / 86_400) as i64;
    let time = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = time / 3_600;
    let minute = (time % 3_600) / 60;
    let second = time % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.000Z")
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = (shifted - era * 146_097) as u64;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i32 + era as i32 * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = if month_prime < 10 { month_prime + 3 } else { month_prime - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year, month as u32, day as u32)
}

fn write_json(stream: &mut TcpStream, status: u16, reason: &str, body: &Value) -> std::io::Result<()> {
    let payload = body.to_string();
    write_raw(stream, status, reason, &payload)
}

fn write_raw(stream: &mut TcpStream, status: u16, reason: &str, body: &str) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    Ok(())
}

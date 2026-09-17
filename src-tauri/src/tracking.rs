use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct TrackingFetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TrackingFetchResult {
    pub status: u16,
    pub text: String,
}

fn allowed_host(host: &str) -> bool {
    matches!(
        host,
        "www.fedex.com"
            | "www.ups.com"
            | "webapis.ups.com"
            | "wwwapps.ups.com"
            | "tools.usps.com"
            | "www.usps.com"
            | "t.17track.net"
            | "www.17track.net"
    )
}

pub async fn fetch_tracking_page(request: TrackingFetchRequest) -> Result<TrackingFetchResult, String> {
    let url = reqwest::Url::parse(request.url.trim()).map_err(|error| error.to_string())?;
    let host = url.host_str().unwrap_or("");
    if !allowed_host(host) {
        return Err("Unsupported tracking host.".into());
    }

    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;

    let method = request.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    let mut builder = if method == "POST" {
        client.post(url)
    } else {
        client.get(url)
    };
    builder = builder.header(
        "Accept",
        "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    );
    if let Some(body) = request.body.as_deref() {
        builder = builder
            .header("Content-Type", "application/json")
            .body(body.to_string());
    }

    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let mut text = response.text().await.map_err(|error| error.to_string())?;
    if text.len() > 250_000 {
        text.truncate(250_000);
    }
    Ok(TrackingFetchResult { status, text })
}

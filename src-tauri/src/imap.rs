use mailparse::{parse_mail, MailHeaderMap, ParsedMail};
use native_tls::TlsConnector;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const IO_TIMEOUT: Duration = Duration::from_secs(45);
const DEFAULT_PORT: u16 = 993;
const DEFAULT_MAILBOX: &str = "INBOX";
const DEFAULT_LIMIT: u32 = 500;
const MAX_LIMIT: u32 = 500;
const FETCH_BATCH: u32 = 25;
const BODY_CHAR_LIMIT: usize = 4000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapSettings {
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: String,
    pub mailbox: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapTestResult {
    pub ok: bool,
    pub mailbox: String,
    pub message_count: u32,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImapMessage {
    pub uid: u32,
    pub message_id: Option<String>,
    pub date: String,
    pub from: String,
    pub to: String,
    pub recipients: Vec<String>,
    pub subject: String,
    pub snippet: String,
    pub body: String,
}

struct NormalizedSettings {
    host: String,
    port: u16,
    username: String,
    password: String,
    mailbox: String,
}

fn normalize_settings(settings: &ImapSettings) -> Result<NormalizedSettings, String> {
    let host = settings.host.trim().to_string();
    if host.is_empty() {
        return Err("IMAP host is required.".to_string());
    }
    let username = settings.username.trim().to_string();
    if username.is_empty() {
        return Err("IMAP username is required.".to_string());
    }
    if settings.password.is_empty() {
        return Err("IMAP key / password is required.".to_string());
    }
    let mailbox = settings
        .mailbox
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_MAILBOX)
        .to_string();
    Ok(NormalizedSettings {
        host,
        port: settings.port.unwrap_or(DEFAULT_PORT),
        username,
        password: settings.password.clone(),
        mailbox,
    })
}

fn connect_client(
    settings: &NormalizedSettings,
) -> Result<imap::Client<native_tls::TlsStream<TcpStream>>, String> {
    let addrs: Vec<_> = (settings.host.as_str(), settings.port)
        .to_socket_addrs()
        .map_err(|error| format!("Could not resolve {}: {error}", settings.host))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("No address found for {}", settings.host));
    }
    let tls = TlsConnector::builder()
        .build()
        .map_err(|error| format!("TLS setup failed: {error}"))?;
    let mut last_error = format!("Could not connect to {}:{}", settings.host, settings.port);
    for addr in addrs {
        let tcp = match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(stream) => stream,
            Err(error) => {
                last_error = format!("Could not connect to {addr}: {error}");
                continue;
            }
        };
        if tcp.set_read_timeout(Some(IO_TIMEOUT)).is_err() || tcp.set_write_timeout(Some(IO_TIMEOUT)).is_err()
        {
            last_error = format!("Could not set timeouts for {addr}");
            continue;
        }
        let tls_stream = match tls.connect(&settings.host, tcp) {
            Ok(stream) => stream,
            Err(error) => {
                last_error = format!("TLS handshake failed: {error}");
                continue;
            }
        };
        let mut client = imap::Client::new(tls_stream);
        match client.read_greeting() {
            Ok(_) => return Ok(client),
            Err(error) => {
                last_error = format!("IMAP greeting failed: {error}");
            }
        }
    }
    Err(last_error)
}

fn login_session(
    settings: &NormalizedSettings,
) -> Result<imap::Session<native_tls::TlsStream<TcpStream>>, String> {
    let client = connect_client(settings)?;
    client
        .login(&settings.username, &settings.password)
        .map_err(|(error, _)| format!("IMAP login failed: {error}"))
}

fn with_session<T>(
    settings: &NormalizedSettings,
    callback: impl FnOnce(&mut imap::Session<native_tls::TlsStream<TcpStream>>) -> Result<T, String>,
) -> Result<T, String> {
    let mut session = login_session(settings)?;
    let result = callback(&mut session);
    let _ = session.logout();
    result
}

pub fn test_imap(settings: ImapSettings) -> Result<ImapTestResult, String> {
    let settings = normalize_settings(&settings)?;
    with_session(&settings, |session| {
        let mailbox = session
            .select(&settings.mailbox)
            .map_err(|error| format!("Could not open {}: {error}", settings.mailbox))?;
        Ok(ImapTestResult {
            ok: true,
            mailbox: settings.mailbox.clone(),
            message_count: mailbox.exists,
            message: format!(
                "Connected to {} as {}. {} has {} message(s).",
                settings.host, settings.username, settings.mailbox, mailbox.exists
            ),
        })
    })
}

pub fn fetch_imap_inbox(settings: ImapSettings, limit: Option<u32>) -> Result<Vec<ImapMessage>, String> {
    let settings = normalize_settings(&settings)?;
    let take = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    with_session(&settings, |session| {
        let mailbox = session
            .select(&settings.mailbox)
            .map_err(|error| format!("Could not open {}: {error}", settings.mailbox))?;
        if mailbox.exists == 0 {
            return Ok(Vec::new());
        }
        let count = take.min(mailbox.exists);
        let start = mailbox.exists - count + 1;
        let mut messages = Vec::new();
        let mut cursor = start;
        while cursor <= mailbox.exists {
            let end = (cursor + FETCH_BATCH - 1).min(mailbox.exists);
            let seq = format!("{cursor}:{end}");
            let fetched = session
                .fetch(&seq, "UID RFC822.PEEK")
                .or_else(|_| session.fetch(&seq, "UID BODY.PEEK[]"))
                .map_err(|error| format!("IMAP fetch failed: {error}"))?;
            messages.extend(fetched.iter().filter_map(parse_fetch_message));
            cursor = end + 1;
        }
        messages.reverse();
        Ok(messages)
    })
}

fn parse_fetch_message(item: &imap::types::Fetch) -> Option<ImapMessage> {
    let raw = item.body()?;
    let parsed = parse_mail(raw).ok()?;
    let headers = parsed.get_headers();
    let mut recipients = BTreeSet::new();
    for name in [
        "To",
        "Cc",
        "Bcc",
        "Delivered-To",
        "X-Original-To",
        "X-Forwarded-To",
        "Envelope-To",
        "X-Envelope-To",
        "Apparently-To",
        "Resent-To",
    ] {
        for value in headers.get_all_values(name) {
            extract_emails(&value, &mut recipients);
        }
    }

    let mut body = String::new();
    collect_text(&parsed, &mut body, false);
    if body.trim().is_empty() {
        collect_text(&parsed, &mut body, true);
    }
    let body = truncate_chars(&collapse_text(&body), BODY_CHAR_LIMIT);
    let snippet = truncate_chars(&body, 280);

    Some(ImapMessage {
        uid: item.uid.unwrap_or(item.message),
        message_id: normalize_message_id(headers.get_first_value("Message-ID")),
        date: headers.get_first_value("Date").unwrap_or_default(),
        from: headers.get_first_value("From").unwrap_or_default(),
        to: headers.get_first_value("To").unwrap_or_default(),
        recipients: recipients.into_iter().collect(),
        subject: headers.get_first_value("Subject").unwrap_or_default(),
        snippet,
        body,
    })
}

fn collect_text(part: &ParsedMail, out: &mut String, allow_html: bool) {
    let mime = part.ctype.mimetype.to_ascii_lowercase();
    if mime == "text/plain" {
        if let Ok(body) = part.get_body() {
            append_text(out, &body);
        }
    } else if allow_html && mime == "text/html" {
        if let Ok(body) = part.get_body() {
            append_text(out, &html_to_text(&body));
        }
    }
    for child in &part.subparts {
        collect_text(child, out, allow_html);
    }
}

fn append_text(out: &mut String, chunk: &str) {
    let trimmed = chunk.trim();
    if trimmed.is_empty() {
        return;
    }
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(trimmed);
}

fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let chars: Vec<char> = html.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '<' {
            let rest: String = chars[i..].iter().take(10).collect::<String>().to_ascii_lowercase();
            if rest.starts_with("<br") || rest.starts_with("<p") || rest.starts_with("<div") || rest.starts_with("<tr")
            {
                out.push('\n');
            }
            in_tag = true;
            i += 1;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            i += 1;
            continue;
        }
        if !in_tag {
            out.push(ch);
        }
        i += 1;
    }
    decode_basic_entities(&out)
}

fn decode_basic_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn collapse_text(value: &str) -> String {
    let mut out = String::new();
    let mut blank = false;
    for line in value.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !out.is_empty() && !blank {
                out.push('\n');
                blank = true;
            }
            continue;
        }
        if !out.is_empty() && !blank {
            out.push('\n');
        }
        out.push_str(trimmed);
        blank = false;
    }
    out
}

fn truncate_chars(value: &str, max: usize) -> String {
    let count = value.chars().count();
    if count <= max {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn normalize_message_id(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().trim_matches(|ch| ch == '<' || ch == '>').trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn extract_emails(input: &str, into: &mut BTreeSet<String>) {
    let chars: Vec<char> = input.chars().collect();
    for i in 0..chars.len() {
        if chars[i] != '@' {
            continue;
        }
        let mut start = i;
        while start > 0 {
            let prev = chars[start - 1];
            if is_email_local(prev) {
                start -= 1;
            } else {
                break;
            }
        }
        let mut end = i + 1;
        while end < chars.len() && is_email_domain(chars[end]) {
            end += 1;
        }
        if start >= i || end <= i + 1 {
            continue;
        }
        let candidate: String = chars[start..end].iter().collect();
        if is_plausible_email(&candidate) {
            into.insert(candidate.to_ascii_lowercase());
        }
    }
}

fn is_email_local(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '%' | '+' | '-')
}

fn is_email_domain(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-')
}

fn is_plausible_email(value: &str) -> bool {
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !local.starts_with('.')
        && !local.ends_with('.')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && domain.chars().any(|ch| ch.is_ascii_alphabetic())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_catch_all_recipients() {
        let mut emails = BTreeSet::new();
        extract_emails("Wally Target <wally.target@shop.example>", &mut emails);
        extract_emails("Delivered-To: jig-14@shop.example", &mut emails);
        assert!(emails.contains("wally.target@shop.example"));
        assert!(emails.contains("jig-14@shop.example"));
    }
}

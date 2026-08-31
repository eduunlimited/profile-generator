use imap_proto::types::{MessageSection, SectionPath};
use mailparse::{addrparse, parse_mail, MailAddr, MailHeaderMap, ParsedMail};
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
const HEADER_FETCH_BATCH: u32 = 50;
const BODY_CHAR_LIMIT: usize = 4000;
const HTML_CHAR_LIMIT: usize = 80_000;
const HTML_PARTS: &[&str] = &["2", "1.2", "2.1", "1.1", "3"];

const HEADER_FETCH_QUERIES: &[&str] = &["(UID BODY.PEEK[HEADER])"];
const BODY_FETCH_QUERIES: &[&str] = &[
    "(UID BODY.PEEK[HEADER] BODY.PEEK[1] BODY.PEEK[2] BODY.PEEK[1.2])",
    "(UID BODY.PEEK[HEADER] BODY.PEEK[2])",
    "(UID BODY.PEEK[HEADER] BODY.PEEK[TEXT] BODY.PEEK[1])",
    "(UID BODY.PEEK[])",
];

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
    pub from_name: String,
    pub from_email: String,
    pub to: String,
    pub recipients: Vec<String>,
    pub subject: String,
    pub snippet: String,
    pub body: String,
    pub html_body: String,
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
        let mut end = mailbox.exists;
        while end >= start {
            let batch_start = end.saturating_sub(HEADER_FETCH_BATCH - 1).max(start);
            messages.extend(fetch_sequence_range(session, batch_start, end, HEADER_FETCH_QUERIES, false)?);
            if batch_start == start {
                break;
            }
            end = batch_start - 1;
        }
        Ok(messages)
    })
}

pub fn fetch_imap_message(settings: ImapSettings, uid: u32) -> Result<ImapMessage, String> {
    if uid == 0 {
        return Err("Message UID is required.".to_string());
    }
    let settings = normalize_settings(&settings)?;
    with_session(&settings, |session| {
        session
            .select(&settings.mailbox)
            .map_err(|error| format!("Could not open {}: {error}", settings.mailbox))?;
        let uid_set = uid.to_string();
        let mut last_error = format!("Could not load message {uid}.");
        for query in BODY_FETCH_QUERIES {
            match session.uid_fetch(&uid_set, *query) {
                Ok(fetched) => {
                    let mut messages: Vec<ImapMessage> =
                        fetched.iter().filter_map(parse_fetch_message).collect();
                    fill_missing_html(session, &mut messages);
                    if let Some(message) = messages.into_iter().next() {
                        return Ok(message);
                    }
                    last_error = format!("Message {uid} had no readable body.");
                }
                Err(error) => {
                    last_error = format!("IMAP fetch failed: {error}");
                }
            }
        }
        Err(last_error)
    })
}

fn fetch_sequence_range(
    session: &mut imap::Session<native_tls::TlsStream<TcpStream>>,
    start: u32,
    end: u32,
    queries: &[&str],
    load_html: bool,
) -> Result<Vec<ImapMessage>, String> {
    let seq = if start == end {
        start.to_string()
    } else {
        format!("{start}:{end}")
    };
    match fetch_with_queries(session, &seq, queries) {
        Ok(fetched) => {
            let mut messages: Vec<ImapMessage> = fetched.iter().filter_map(parse_fetch_message).collect();
            if load_html {
                fill_missing_html(session, &mut messages);
            }
            Ok(messages)
        }
        Err(batch_error) if start != end => {
            let mut messages = Vec::new();
            for seq_num in start..=end {
                match fetch_with_queries(session, &seq_num.to_string(), queries) {
                    Ok(fetched) => {
                        let mut parsed: Vec<ImapMessage> =
                            fetched.iter().filter_map(parse_fetch_message).collect();
                        if load_html {
                            fill_missing_html(session, &mut parsed);
                        }
                        messages.extend(parsed);
                    }
                    Err(_) => continue,
                }
            }
            if messages.is_empty() {
                return Err(batch_error);
            }
            Ok(messages)
        }
        Err(error) => Err(error),
    }
}

fn fill_missing_html(
    session: &mut imap::Session<native_tls::TlsStream<TcpStream>>,
    messages: &mut [ImapMessage],
) {
    for message in messages {
        if !message.html_body.trim().is_empty() {
            continue;
        }
        for part in HTML_PARTS {
            let query = format!("(BODY.PEEK[{part}])");
            let Ok(fetched) = session.uid_fetch(message.uid.to_string(), query) else {
                continue;
            };
            for item in fetched.iter() {
                for bytes in html_section_bytes(item) {
                    let html = extract_html_from_bytes(bytes);
                    if !html.trim().is_empty() {
                        message.html_body = truncate_chars(&html, HTML_CHAR_LIMIT);
                        break;
                    }
                }
                if !message.html_body.trim().is_empty() {
                    break;
                }
            }
            if !message.html_body.trim().is_empty() {
                break;
            }
        }
    }
}

fn fetch_with_queries(
    session: &mut imap::Session<native_tls::TlsStream<TcpStream>>,
    seq: &str,
    queries: &[&str],
) -> Result<imap::types::ZeroCopy<Vec<imap::types::Fetch>>, String> {
    let mut last_error = format!("IMAP fetch failed for {seq}.");
    for query in queries {
        match session.fetch(seq, *query) {
            Ok(fetched) => return Ok(fetched),
            Err(error) => {
                last_error = format!("IMAP fetch failed: {error}");
            }
        }
    }
    Err(last_error)
}

fn fetch_raw_bytes(item: &imap::types::Fetch) -> Option<Vec<u8>> {
    if let Some(body) = item.body() {
        return Some(body.to_vec());
    }
    let header = item.header()?;
    let mut raw = header.to_vec();
    ensure_header_body_separator(&mut raw);
    if let Some(text) = first_body_bytes(item) {
        raw.extend_from_slice(text);
    }
    Some(raw)
}

fn ensure_header_body_separator(raw: &mut Vec<u8>) {
    if raw.ends_with(b"\r\n\r\n") || raw.ends_with(b"\n\n") {
        return;
    }
    if raw.ends_with(b"\r\n") {
        raw.extend_from_slice(b"\r\n");
    } else if raw.ends_with(b"\n") {
        raw.push(b'\n');
    } else {
        raw.extend_from_slice(b"\r\n\r\n");
    }
}

fn first_body_bytes(item: &imap::types::Fetch) -> Option<&[u8]> {
    item.body()
        .or_else(|| item.text())
        .or_else(|| item.section(&SectionPath::Part(vec![1], None)))
        .or_else(|| item.section(&SectionPath::Part(vec![1], Some(MessageSection::Text))))
        .or_else(|| item.section(&SectionPath::Part(vec![1, 1], None)))
}

fn html_section_bytes(item: &imap::types::Fetch) -> Vec<&[u8]> {
    let paths = [
        SectionPath::Part(vec![2], None),
        SectionPath::Part(vec![2], Some(MessageSection::Text)),
        SectionPath::Part(vec![1, 2], None),
        SectionPath::Part(vec![1, 2], Some(MessageSection::Text)),
        SectionPath::Part(vec![2, 1], None),
        SectionPath::Part(vec![2, 1], Some(MessageSection::Text)),
        SectionPath::Part(vec![1], None),
        SectionPath::Part(vec![1, 1], None),
    ];
    let mut out: Vec<&[u8]> = Vec::new();
    for part in std::iter::once(item.body())
        .chain(std::iter::once(item.text()))
        .chain(paths.iter().map(|path| item.section(path)))
        .flatten()
    {
        if !part.is_empty() && !out.iter().any(|existing| *existing == part) {
            out.push(part);
        }
    }
    out
}

fn decode_part_text(bytes: &[u8]) -> String {
    if let Ok(parsed) = parse_mail(bytes) {
        let mut body = String::new();
        collect_text(&parsed, &mut body, false);
        if body.trim().is_empty() {
            collect_text(&parsed, &mut body, true);
        }
        if body.trim().is_empty() {
            if let Ok(decoded) = parsed.get_body() {
                body = decoded;
            }
        }
        if !body.trim().is_empty() {
            return normalize_body_text(&body);
        }
    }
    normalize_body_text(&String::from_utf8_lossy(bytes))
}

fn normalize_body_text(value: &str) -> String {
    let collapsed = collapse_text(value);
    let text = if looks_like_html(&collapsed) {
        collapse_text(&html_to_text(&collapsed))
    } else {
        collapsed
    };
    truncate_chars(&text, BODY_CHAR_LIMIT)
}

fn looks_like_html(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("<html")
        || lower.contains("<!doctype")
        || lower.contains("<body")
        || lower.contains("<div")
        || lower.contains("<table")
        || lower.contains("<br")
        || lower.contains("<p>")
        || lower.contains("<p ")
        || lower.contains("<span")
        || lower.contains("<style")
}

fn parse_fetch_message(item: &imap::types::Fetch) -> Option<ImapMessage> {
    let raw = fetch_raw_bytes(item).or_else(|| item.header().map(|header| header.to_vec()))?;
    let parsed = parse_mail(&raw)
        .ok()
        .or_else(|| item.header().and_then(|header| parse_mail(header).ok()))?;
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
    if body.trim().is_empty() {
        if let Some(bytes) = first_body_bytes(item) {
            body = decode_part_text(bytes);
        }
    }
    if body.trim().is_empty() {
        if let Ok(decoded) = parsed.get_body() {
            body = decoded;
        }
    }
    let mut html_body = String::new();
    collect_html(&parsed, &mut html_body);
    if html_body.trim().is_empty() {
        for bytes in html_section_bytes(item) {
            html_body = extract_html_from_bytes(bytes);
            if !html_body.trim().is_empty() {
                break;
            }
        }
    }
    if html_body.trim().is_empty() && looks_like_html(&body) {
        html_body = body.clone();
    }
    let body = normalize_body_text(&body);
    let html_body = if html_body.trim().is_empty() {
        String::new()
    } else {
        truncate_chars(&html_body, HTML_CHAR_LIMIT)
    };
    let snippet = truncate_chars(&body, 280);

    let from = headers.get_first_value("From").unwrap_or_default();
    let (from_name, from_email) = split_sender(&from);
    Some(ImapMessage {
        uid: item.uid.unwrap_or(item.message),
        message_id: normalize_message_id(headers.get_first_value("Message-ID")),
        date: headers.get_first_value("Date").unwrap_or_default(),
        from,
        from_name,
        from_email,
        to: headers.get_first_value("To").unwrap_or_default(),
        recipients: recipients.into_iter().collect(),
        subject: headers.get_first_value("Subject").unwrap_or_default(),
        snippet,
        body,
        html_body,
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

fn collect_html(part: &ParsedMail, out: &mut String) {
    if !out.is_empty() {
        return;
    }
    let mime = part.ctype.mimetype.to_ascii_lowercase();
    if mime == "text/html" {
        let body = part_body_lossy(part);
        if !body.trim().is_empty() {
            *out = body;
            return;
        }
    }
    for child in &part.subparts {
        collect_html(child, out);
        if !out.is_empty() {
            return;
        }
    }
}

fn extract_html_from_bytes(bytes: &[u8]) -> String {
    if let Some(html) = html_from_parsed_or_raw(bytes) {
        return html;
    }
    for encoding in ["quoted-printable", "base64", "8bit"] {
        let mut wrapped = format!(
            "MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: {encoding}\r\n\r\n"
        )
        .into_bytes();
        wrapped.extend_from_slice(bytes);
        if let Some(html) = html_from_parsed_or_raw(&wrapped) {
            if looks_like_html(&html) {
                return html;
            }
        }
    }
    String::new()
}

fn html_from_parsed_or_raw(bytes: &[u8]) -> Option<String> {
    if let Ok(parsed) = parse_mail(bytes) {
        let mut html = String::new();
        collect_html(&parsed, &mut html);
        if !html.trim().is_empty() {
            return Some(html);
        }
        let decoded = part_body_lossy(&parsed);
        if looks_like_html(&decoded) {
            return Some(decoded);
        }
    }
    let decoded = String::from_utf8_lossy(bytes).into_owned();
    if looks_like_html(&decoded) {
        Some(decoded)
    } else {
        None
    }
}

fn part_body_lossy(part: &ParsedMail) -> String {
    if let Ok(body) = part.get_body() {
        if !body.trim().is_empty() {
            return body;
        }
    }
    part.get_body_raw()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
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

fn split_sender(from: &str) -> (String, String) {
    if let Ok(list) = addrparse(from) {
        for addr in list.iter() {
            match addr {
                MailAddr::Single(info) => {
                    return (
                        info.display_name.clone().unwrap_or_default(),
                        info.addr.clone(),
                    );
                }
                MailAddr::Group(group) => {
                    if let Some(info) = group.addrs.first() {
                        return (
                            info.display_name.clone().unwrap_or_else(|| group.group_name.clone()),
                            info.addr.clone(),
                        );
                    }
                }
            }
        }
    }
    let trimmed = from.trim();
    if let Some((name, email)) = trimmed.rsplit_once('<') {
        let email = email.trim().trim_end_matches('>').trim();
        let name = name.trim().trim_matches('"').trim();
        return (name.to_string(), email.to_string());
    }
    if trimmed.contains('@') {
        return (String::new(), trimmed.to_string());
    }
    (trimmed.to_string(), String::new())
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

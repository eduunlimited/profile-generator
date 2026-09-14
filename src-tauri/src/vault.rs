use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "com.edu-u.profile-generator";
const KEYRING_USER: &str = "card-vault";
const ALG: &str = "aes-256-gcm";
const PIN_SETUP_MESSAGE: &str =
    "Set up a Windows PIN in Windows Settings (Sign-in options) before exporting card numbers.";

#[derive(Serialize, Deserialize)]
pub struct SecretEnvelope {
    v: u8,
    alg: String,
    n: String,
    ct: String,
}

fn wrapping_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(stored) => {
            let bytes = BASE64
                .decode(stored.trim())
                .map_err(|error| format!("Card vault key is unreadable: {error}"))?;
            bytes
                .try_into()
                .map_err(|_| "Card vault key is the wrong size.".to_string())
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            getrandom::getrandom(&mut key).map_err(|error| error.to_string())?;
            entry
                .set_password(&BASE64.encode(key))
                .map_err(|error| error.to_string())?;
            Ok(key)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn encrypt_plaintext(plaintext: &str) -> Result<SecretEnvelope, String> {
    let key = wrapping_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).map_err(|error| error.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(SecretEnvelope {
        v: 1,
        alg: ALG.to_string(),
        n: BASE64.encode(nonce_bytes),
        ct: BASE64.encode(ciphertext),
    })
}

fn decrypt_envelope(envelope: &SecretEnvelope) -> Result<String, String> {
    if envelope.v != 1 || envelope.alg != ALG {
        return Err("Unsupported card encryption format.".into());
    }
    let key = wrapping_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce_bytes = BASE64
        .decode(envelope.n.trim())
        .map_err(|error| format!("Card nonce is unreadable: {error}"))?;
    if nonce_bytes.len() != 12 {
        return Err("Card nonce is the wrong size.".into());
    }
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = BASE64
        .decode(envelope.ct.trim())
        .map_err(|error| format!("Card ciphertext is unreadable: {error}"))?;
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Could not decrypt card data for this Windows user.".to_string())?;
    String::from_utf8(plaintext).map_err(|error| error.to_string())
}

fn unprotect_value(value: Value) -> Result<String, String> {
    match value {
        Value::Null => Ok(String::new()),
        Value::String(text) => Ok(text),
        other => {
            let envelope: SecretEnvelope = serde_json::from_value(other)
                .map_err(|_| "Card data is not a valid encrypted value.".to_string())?;
            decrypt_envelope(&envelope)
        }
    }
}

#[tauri::command]
pub fn protect_secret(plaintext: String) -> Result<SecretEnvelope, String> {
    encrypt_plaintext(&plaintext)
}

#[tauri::command]
pub fn protect_secrets(plaintexts: Vec<String>) -> Result<Vec<SecretEnvelope>, String> {
    plaintexts.iter().map(|text| encrypt_plaintext(text)).collect()
}

#[tauri::command]
pub fn unprotect_secret(value: Value) -> Result<String, String> {
    unprotect_value(value)
}

#[tauri::command]
pub fn unprotect_secrets(values: Vec<Value>) -> Result<Vec<String>, String> {
    values.into_iter().map(unprotect_value).collect()
}

#[tauri::command]
pub async fn confirm_windows_user(app: AppHandle, message: String) -> Result<bool, String> {
    #[cfg(not(windows))]
    {
        let _ = (app, message);
        Err("Windows Hello is only available in the Windows desktop app.".into())
    }
    #[cfg(windows)]
    {
        confirm_windows_user_windows(app, message).await
    }
}

#[cfg(windows)]
fn map_hello_result(
    result: windows::Security::Credentials::UI::UserConsentVerificationResult,
) -> Result<bool, String> {
    use windows::Security::Credentials::UI::UserConsentVerificationResult;
    match result {
        UserConsentVerificationResult::Verified => Ok(true),
        UserConsentVerificationResult::Canceled => Ok(false),
        UserConsentVerificationResult::NotConfiguredForUser
        | UserConsentVerificationResult::DeviceNotPresent
        | UserConsentVerificationResult::DisabledByPolicy => Err(PIN_SETUP_MESSAGE.into()),
        other => Err(format!("Windows Hello could not verify ({other:?}).")),
    }
}

#[cfg(windows)]
async fn confirm_windows_user_windows(app: AppHandle, message: String) -> Result<bool, String> {
    use std::future::IntoFuture;
    use windows::core::{factory, HSTRING};
    use windows::Security::Credentials::UI::{
        UserConsentVerifier, UserConsentVerifierAvailability, UserConsentVerificationResult,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found.".to_string())?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;

    let availability = UserConsentVerifier::CheckAvailabilityAsync()
        .map_err(|error| error.to_string())?
        .into_future()
        .await
        .map_err(|error| error.to_string())?;

    match availability {
        UserConsentVerifierAvailability::Available => {}
        UserConsentVerifierAvailability::DeviceBusy => {
            return Err("Windows Hello is busy. Try again.".into());
        }
        _ => return Err(PIN_SETUP_MESSAGE.into()),
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let started = (|| {
                let hwnd = HWND(hwnd as *mut core::ffi::c_void);
                let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
                    .map_err(|error| error.to_string())?;
                unsafe { interop.RequestVerificationForWindowAsync(hwnd, &HSTRING::from(message.as_str())) }
                    .map_err(|error| error.to_string())
            })();
            let _ = tx.send(started);
        })
        .map_err(|error| error.to_string())?;

    let operation: windows_future::IAsyncOperation<UserConsentVerificationResult> = rx
        .await
        .map_err(|_| "Windows Hello was interrupted.".to_string())??;
    let verified = operation
        .into_future()
        .await
        .map_err(|error| error.to_string())?;
    map_hello_result(verified)
}

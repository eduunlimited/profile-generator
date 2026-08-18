fn main() {
    let license_api_url = std::env::var("LICENSE_API_URL").unwrap_or_default();
    println!("cargo:rustc-env=LICENSE_API_URL={license_api_url}");
    tauri_build::build()
}

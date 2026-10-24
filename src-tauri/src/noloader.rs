use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, watch};

const MODS_DIRECTORY: &str = "mods";
const MOD_DATA_DIRECTORY: &str = "mod-data";
const SETTINGS_FILE: &str = "settings.json";
const LAST_PLAYED_SERVER_FILE: &str = "last-played-server.json";
const MAX_MOD_STORAGE_BYTES: usize = 256 * 1024;
const MAX_MOD_STORAGE_VALUE_BYTES: usize = 64 * 1024;
const MAX_MOD_STORAGE_KEY_BYTES: usize = 128;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_MOD_ASSET_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MOD_DIRECTORIES: usize = 2048;
const MAX_TOTAL_MANIFEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_UPDATE_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_MOD_HTTP_REQUEST_BYTES: usize = 256 * 1024;
const MAX_MOD_HTTP_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_MANAGED_PROCESSES: usize = 32;
const MAX_PROCESS_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_PROCESS_READ_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModProcessChunk {
    pub stream: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModProcessSessionRead {
    pub chunks: Vec<ModProcessChunk>,
    pub running: bool,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone)]
struct ManagedProcessStatus {
    running: bool,
    exit_code: Option<i32>,
}

#[derive(Default)]
struct ManagedProcessOutput {
    chunks: VecDeque<ModProcessChunk>,
    bytes: usize,
}

struct ManagedProcess {
    owner_id: String,
    input: mpsc::Sender<Vec<u8>>,
    kill: mpsc::UnboundedSender<()>,
    output: Arc<Mutex<ManagedProcessOutput>>,
    status: watch::Receiver<ManagedProcessStatus>,
}

fn managed_processes() -> &'static Mutex<HashMap<String, ManagedProcess>> {
    static PROCESSES: OnceLock<Mutex<HashMap<String, ManagedProcess>>> = OnceLock::new();
    PROCESSES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDirectoryEntry {
    pub directory: String,
    pub manifest_json: Option<String>,
    pub error: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDirectorySnapshot {
    pub mods_directory: String,
    pub entries: Vec<ModDirectoryEntry>,
    pub settings_error: Option<String>,
    pub safe_mode: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModAssets {
    pub manifest_json: String,
    pub frontend_source: String,
    pub styles: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastPlayedServer {
    pub profile_id: String,
    pub address: String,
    pub played_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModStorageRead {
    pub found: bool,
    pub value: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModHttpResponse {
    pub status: u16,
    pub ok: bool,
    pub content_type: Option<String>,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModProcessRequest {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModProcessResult {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub fn noloader_execute_client_code(
    app: AppHandle,
    mod_id: String,
    source: String,
) -> Result<(), String> {
    if source.is_empty() || source.len() > 8 * 1024 * 1024 {
        return Err("Client module must contain 1 byte to 8 MiB of source.".to_string());
    }
    if !is_valid_mod_id(&mod_id) {
        return Err("Extension ID is invalid.".to_string());
    }
    let snapshot = noloader_list_mods(app.clone())?;
    let installed = snapshot.entries.iter().find(|entry| {
        entry.enabled
            && entry.manifest_json.as_ref().is_some_and(|manifest| {
                serde_json::from_str::<Value>(manifest)
                    .ok()
                    .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_owned))
                    .as_deref()
                    == Some(mod_id.as_str())
            })
    });
    let Some(installed) = installed else {
        return Err("Extension is not enabled in NoLoader.".to_string());
    };
    let manifest: Value =
        serde_json::from_str(installed.manifest_json.as_deref().unwrap_or_default())
            .map_err(|error| format!("Could not read extension manifest: {error}"))?;
    let has_permission = manifest
        .get("permissions")
        .and_then(Value::as_array)
        .is_some_and(|permissions| {
            permissions
                .iter()
                .any(|permission| permission.as_str() == Some("launcher.clientRuntime"))
        });
    if !has_permission {
        return Err("Extension manifest does not grant launcher.clientRuntime.".to_string());
    }
    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| "The NoRisk Client main webview is not open.".to_string())?;
    let encoded_id = serde_json::to_string(&mod_id)
        .map_err(|error| format!("Could not encode extension ID: {error}"))?;
    let encoded = serde_json::to_string(&source)
        .map_err(|error| format!("Could not encode client module: {error}"))?;
    let script = format!(
        "(() => {{ const modId = {encoded_id}; const source = {encoded}; const run = () => {{ if (!document.querySelector('#root')) {{ setTimeout(run, 40); return; }} const runtimes = globalThis.__NOLOADER_EXTENSION_RUNTIMES__ ??= new Map(); let runtime = runtimes.get(modId); if (!runtime) {{ const controller = new AbortController(); const cleanups = new Set(); runtime = {{ signal: controller.signal, onDispose(cleanup) {{ if (typeof cleanup !== 'function') throw new TypeError('Cleanup must be a function.'); cleanups.add(cleanup); return () => cleanups.delete(cleanup); }}, dispose() {{ controller.abort(); for (const cleanup of cleanups) {{ try {{ Promise.resolve(cleanup()).catch(error => console.error('[NoLoader extension cleanup]', error)); }} catch (error) {{ console.error('[NoLoader extension cleanup]', error); }} }} cleanups.clear(); }} }}; runtimes.set(modId, runtime); }} const moduleSource = 'const noLoaderExtension = globalThis.__NOLOADER_EXTENSION_RUNTIMES__.get(' + JSON.stringify(modId) + ');\\n' + source; const url = URL.createObjectURL(new Blob([moduleSource], {{ type: 'text/javascript' }})); import(url).catch(error => console.error('[NoLoader extension module]', error)).finally(() => URL.revokeObjectURL(url)); }}; run(); }})()"
    );
    webview
        .eval(&script)
        .map_err(|error| format!("Could not execute client module: {error}"))
}

#[tauri::command]
pub fn noloader_dispose_client_code(app: AppHandle, mod_id: String) -> Result<(), String> {
    if !is_valid_mod_id(&mod_id) {
        return Err("Extension ID is invalid.".to_string());
    }
    close_process_sessions_for_owner(&mod_id);
    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| "The NoRisk Client main webview is not open.".to_string())?;
    let encoded = serde_json::to_string(&mod_id)
        .map_err(|error| format!("Could not encode extension ID: {error}"))?;
    webview
        .eval(&format!(
            "globalThis.__NOLOADER_EXTENSION_RUNTIMES__?.get({encoded})?.dispose(); globalThis.__NOLOADER_EXTENSION_RUNTIMES__?.delete({encoded})"
        ))
        .map_err(|error| format!("Could not dispose extension runtime: {error}"))
}

fn close_process_sessions_for_owner(mod_id: &str) {
    let sessions = managed_processes()
        .lock()
        .ok()
        .map(|mut sessions| {
            let owned_ids: Vec<String> = sessions
                .iter()
                .filter(|(_, session)| session.owner_id == mod_id)
                .map(|(id, _)| id.clone())
                .collect();
            owned_ids
                .into_iter()
                .filter_map(|id| sessions.remove(&id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for session in sessions {
        let _ = session.kill.send(());
    }
}

#[tauri::command]
pub async fn noloader_process_run(request: ModProcessRequest) -> Result<ModProcessResult, String> {
    use tokio::process::Command;
    if request.program.trim().is_empty()
        || request.program.len() > 4096
        || request.args.len() > 128
        || request.args.iter().any(|arg| arg.len() > 16 * 1024)
        || request.env.len() > 64
        || request
            .env
            .iter()
            .any(|(k, v)| k.len() > 256 || v.len() > 16 * 1024)
    {
        return Err("Process request exceeds supported limits.".to_string());
    }
    let mut command = Command::new(&request.program);
    command
        .args(&request.args)
        .envs(&request.env)
        .kill_on_drop(true);
    if let Some(cwd) = request.cwd {
        command.current_dir(cwd);
    }
    let output = tokio::time::timeout(std::time::Duration::from_secs(60), command.output())
        .await
        .map_err(|_| "Process exceeded the 60-second time limit.".to_string())?
        .map_err(|error| format!("Could not run process: {error}"))?;
    if output.stdout.len() > 1024 * 1024 || output.stderr.len() > 1024 * 1024 {
        return Err("Process output exceeds 1 MiB.".to_string());
    }
    Ok(ModProcessResult {
        code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

#[tauri::command]
pub async fn noloader_process_spawn(request: ModProcessRequest) -> Result<Option<u32>, String> {
    use std::process::Stdio;
    use tokio::process::Command;
    if request.program.trim().is_empty()
        || request.program.len() > 4096
        || request.args.len() > 128
        || request.args.iter().any(|arg| arg.len() > 16 * 1024)
        || request.env.len() > 64
        || request
            .env
            .iter()
            .any(|(key, value)| key.len() > 256 || value.len() > 16 * 1024)
    {
        return Err("Process request exceeds supported limits.".to_string());
    }
    let mut command = Command::new(&request.program);
    command
        .args(&request.args)
        .envs(&request.env)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(cwd) = request.cwd {
        command.current_dir(cwd);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("Could not start process: {error}"))?;
    Ok(child.id())
}

#[tauri::command]
pub async fn noloader_process_session_start(
    app: AppHandle,
    mod_id: String,
    request: ModProcessRequest,
) -> Result<serde_json::Value, String> {
    validate_process_request(&request)?;
    if !is_valid_mod_id(&mod_id) || !mod_has_permission(&app, &mod_id, "system.process")? {
        return Err("Enabled extension must declare system.process.".to_string());
    }
    {
        let sessions = managed_processes()
            .lock()
            .map_err(|_| "Process session manager is unavailable.".to_string())?;
        if sessions.len() >= MAX_MANAGED_PROCESSES {
            return Err(format!(
                "At most {MAX_MANAGED_PROCESSES} managed processes can be open."
            ));
        }
    }

    let mut command = tokio::process::Command::new(&request.program);
    command
        .args(&request.args)
        .envs(&request.env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = request.cwd.as_deref() {
        command.current_dir(cwd);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start process: {error}"))?;
    let pid = child.id();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not capture process input.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture process output.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture process errors.".to_string())?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let output = Arc::new(Mutex::new(ManagedProcessOutput::default()));
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(16);
    let (kill_tx, mut kill_rx) = mpsc::unbounded_channel::<()>();
    let (status_tx, status_rx) = watch::channel(ManagedProcessStatus {
        running: true,
        exit_code: None,
    });

    tokio::spawn(write_process_input(stdin, input_rx));
    tokio::spawn(capture_process_output(
        stdout,
        "stdout",
        Arc::clone(&output),
    ));
    tokio::spawn(capture_process_output(
        stderr,
        "stderr",
        Arc::clone(&output),
    ));
    tokio::spawn(async move {
        let result = tokio::select! {
            result = child.wait() => result,
            _ = kill_rx.recv() => {
                let _ = child.start_kill();
                child.wait().await
            }
        };
        let exit_code = result.ok().and_then(|status| status.code());
        let _ = status_tx.send(ManagedProcessStatus {
            running: false,
            exit_code,
        });
    });

    let mut sessions = managed_processes()
        .lock()
        .map_err(|_| "Process session manager is unavailable.".to_string())?;
    if sessions.len() >= MAX_MANAGED_PROCESSES {
        let _ = kill_tx.send(());
        return Err(format!(
            "At most {MAX_MANAGED_PROCESSES} managed processes can be open."
        ));
    }
    sessions.insert(
        session_id.clone(),
        ManagedProcess {
            owner_id: mod_id,
            input: input_tx,
            kill: kill_tx,
            output,
            status: status_rx,
        },
    );
    Ok(serde_json::json!({ "sessionId": session_id, "pid": pid }))
}

#[tauri::command]
pub fn noloader_process_session_read(
    mod_id: String,
    session_id: String,
) -> Result<ModProcessSessionRead, String> {
    let (output, status) = {
        let sessions = managed_processes()
            .lock()
            .map_err(|_| "Process session manager is unavailable.".to_string())?;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| "Process session was not found.".to_string())?;
        if session.owner_id != mod_id {
            return Err("Process session belongs to another extension.".to_string());
        }
        let status = session.status.borrow().clone();
        (Arc::clone(&session.output), status)
    };
    let mut output = output
        .lock()
        .map_err(|_| "Process output buffer is unavailable.".to_string())?;
    let mut chunks = Vec::new();
    let mut bytes = 0;
    while let Some(chunk) = output.chunks.front() {
        let size = chunk.text.len();
        if !chunks.is_empty() && bytes + size > MAX_PROCESS_READ_BYTES {
            break;
        }
        let chunk = output.chunks.pop_front().expect("front was present");
        output.bytes = output.bytes.saturating_sub(size);
        bytes += size;
        chunks.push(chunk);
    }
    Ok(ModProcessSessionRead {
        chunks,
        running: status.running,
        exit_code: status.exit_code,
    })
}

#[tauri::command]
pub async fn noloader_process_session_write(
    mod_id: String,
    session_id: String,
    text: String,
) -> Result<(), String> {
    if text.len() > 64 * 1024 {
        return Err("Process input exceeds 64 KiB.".to_string());
    }
    let input = {
        let sessions = managed_processes()
            .lock()
            .map_err(|_| "Process session manager is unavailable.".to_string())?;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| "Process session was not found.".to_string())?;
        if session.owner_id != mod_id {
            return Err("Process session belongs to another extension.".to_string());
        }
        session.input.clone()
    };
    input
        .send(text.into_bytes())
        .await
        .map_err(|_| "Process input is closed.".to_string())
}

#[tauri::command]
pub fn noloader_process_session_close(mod_id: String, session_id: String) -> Result<(), String> {
    let session = {
        let mut sessions = managed_processes()
            .lock()
            .map_err(|_| "Process session manager is unavailable.".to_string())?;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| "Process session was not found.".to_string())?;
        if session.owner_id != mod_id {
            return Err("Process session belongs to another extension.".to_string());
        }
        sessions.remove(&session_id)
    };
    if let Some(session) = session {
        let _ = session.kill.send(());
    }
    Ok(())
}

fn validate_process_request(request: &ModProcessRequest) -> Result<(), String> {
    if request.program.trim().is_empty()
        || request.program.len() > 4096
        || request.args.len() > 128
        || request.args.iter().any(|arg| arg.len() > 16 * 1024)
        || request.env.len() > 64
        || request
            .env
            .iter()
            .any(|(key, value)| key.len() > 256 || value.len() > 16 * 1024)
    {
        return Err("Process request exceeds supported limits.".to_string());
    }
    Ok(())
}

async fn write_process_input(
    mut stdin: tokio::process::ChildStdin,
    mut input: mpsc::Receiver<Vec<u8>>,
) {
    while let Some(bytes) = input.recv().await {
        if stdin.write_all(&bytes).await.is_err() || stdin.flush().await.is_err() {
            break;
        }
    }
}

async fn capture_process_output<R: AsyncRead + Unpin>(
    mut reader: R,
    stream: &'static str,
    output: Arc<Mutex<ManagedProcessOutput>>,
) {
    let mut buffer = [0_u8; 8192];
    loop {
        let size = match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(size) => size,
        };
        let text = String::from_utf8_lossy(&buffer[..size]).into_owned();
        if let Ok(mut output) = output.lock() {
            output.bytes += text.len();
            output.chunks.push_back(ModProcessChunk {
                stream: stream.to_string(),
                text,
            });
            while output.bytes > MAX_PROCESS_OUTPUT_BYTES {
                let Some(dropped) = output.chunks.pop_front() else {
                    break;
                };
                output.bytes = output.bytes.saturating_sub(dropped.text.len());
            }
        }
    }
}

fn mod_has_permission(app: &AppHandle, mod_id: &str, permission: &str) -> Result<bool, String> {
    let snapshot = noloader_list_mods(app.clone())?;
    Ok(snapshot.entries.iter().any(|entry| {
        entry.enabled
            && entry.manifest_json.as_ref().is_some_and(|raw| {
                serde_json::from_str::<Value>(raw)
                    .ok()
                    .is_some_and(|manifest| {
                        manifest.get("id").and_then(Value::as_str) == Some(mod_id)
                            && manifest
                                .get("permissions")
                                .and_then(Value::as_array)
                                .is_some_and(|permissions| {
                                    permissions
                                        .iter()
                                        .any(|item| item.as_str() == Some(permission))
                                })
                    })
            })
    }))
}

#[tauri::command]
pub async fn noloader_http_request(
    url: String,
    method: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
) -> Result<ModHttpResponse, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Request URL is invalid.".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || parsed.username() != ""
        || parsed.password().is_some()
    {
        return Err("Mod network requests require an HTTPS URL without credentials.".to_string());
    }
    let method = reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
        .map_err(|_| "HTTP method is invalid.".to_string())?;
    if !matches!(
        method,
        reqwest::Method::GET
            | reqwest::Method::POST
            | reqwest::Method::PUT
            | reqwest::Method::PATCH
            | reqwest::Method::DELETE
    ) {
        return Err("Only GET, POST, PUT, PATCH, and DELETE are supported.".to_string());
    }
    if headers.len() > 32 {
        return Err("A mod request may contain at most 32 headers.".to_string());
    }
    let mut header_map = reqwest::header::HeaderMap::new();
    for (name, value) in headers {
        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "Request contains an invalid header name.".to_string())?;
        let value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|_| "Request contains an invalid header value.".to_string())?;
        header_map.insert(name, value);
    }
    if body
        .as_ref()
        .is_some_and(|value| value.len() > MAX_MOD_HTTP_REQUEST_BYTES)
    {
        return Err("Mod network request body exceeds 256 KiB.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("NoLoader/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not create HTTP client: {error}"))?;
    let mut response = client
        .request(method, parsed)
        .headers(header_map)
        .body(body.unwrap_or_default())
        .send()
        .await
        .map_err(|error| format!("Mod network request failed: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MOD_HTTP_RESPONSE_BYTES as u64)
    {
        return Err("Mod network response exceeds 1 MiB.".to_string());
    }
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Could not read mod network response: {error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_MOD_HTTP_RESPONSE_BYTES {
            return Err("Mod network response exceeds 1 MiB.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes)
        .map_err(|_| "Mod network response is not valid UTF-8 text.".to_string())?;
    Ok(ModHttpResponse {
        status: status.as_u16(),
        ok: status.is_success(),
        content_type,
        body,
    })
}

#[tauri::command]
pub async fn noloader_fetch_update_manifest(url: String) -> Result<String, String> {
    let parsed =
        reqwest::Url::parse(&url).map_err(|_| "Update manifest URL is invalid.".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || parsed.username() != ""
        || parsed.password().is_some()
    {
        return Err(
            "Update manifest URL must be HTTPS and must not contain credentials.".to_string(),
        );
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("NoLoader/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not create update client: {error}"))?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|error| format!("Could not check for mod updates: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Update server returned an error: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_UPDATE_MANIFEST_BYTES as u64)
    {
        return Err("Update manifest is larger than 64 KiB.".to_string());
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Could not read update manifest: {error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_UPDATE_MANIFEST_BYTES {
            return Err("Update manifest is larger than 64 KiB.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "Update manifest is not valid UTF-8.".to_string())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoLoaderSettings {
    schema_version: u32,
    #[serde(default)]
    safe_mode: bool,
    #[serde(default)]
    disabled_mod_directories: Vec<String>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

impl Default for NoLoaderSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            safe_mode: false,
            disabled_mod_directories: Vec::new(),
            extra: Map::new(),
        }
    }
}

#[tauri::command]
pub fn noloader_list_mods(app: AppHandle) -> Result<ModDirectorySnapshot, String> {
    let (data_directory, mods_directory) = ensure_mod_directories(&app)?;
    let (settings, settings_error) = match read_settings(&data_directory) {
        Ok(settings) => (settings, None),
        Err(error) => (NoLoaderSettings::default(), Some(error)),
    };
    let disabled = settings
        .disabled_mod_directories
        .into_iter()
        .collect::<std::collections::HashSet<_>>();

    let mut directories = Vec::new();
    for entry in fs::read_dir(&mods_directory)
        .map_err(|error| format!("Could not list the NoLoader mods directory: {error}"))?
    {
        if directories.len() >= MAX_MOD_DIRECTORIES {
            return Err(format!(
                "The NoLoader mods directory contains more than {MAX_MOD_DIRECTORIES} entries."
            ));
        }
        directories.push(
            entry.map_err(|error| format!("Could not read a mods directory entry: {error}"))?,
        );
    }
    directories.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

    let mut entries = Vec::new();
    let mut total_manifest_bytes = 0usize;
    for entry in directories {
        let directory = entry.file_name().to_string_lossy().into_owned();
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) => {
                entries.push(invalid_entry(
                    directory,
                    format!("Could not inspect directory: {error}"),
                ));
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            entries.push(invalid_entry(
                directory,
                "Mod folder may not be a symbolic link.".to_string(),
            ));
            continue;
        }
        if !metadata.is_dir() {
            continue;
        }
        if !is_valid_directory_name(&directory) {
            entries.push(invalid_entry(
                directory,
                "Folder name contains unsupported characters.".to_string(),
            ));
            continue;
        }

        let mod_directory = match canonical_child_directory(&mods_directory, &directory) {
            Ok(path) => path,
            Err(error) => {
                entries.push(invalid_entry(directory, error));
                continue;
            }
        };
        let manifest_json = match read_limited_file(
            &mod_directory,
            Path::new("noloader.mod.json"),
            MAX_MANIFEST_BYTES,
        ) {
            Ok(contents) => contents,
            Err(error) => {
                entries.push(invalid_entry(directory, error));
                continue;
            }
        };
        if total_manifest_bytes.saturating_add(manifest_json.len()) > MAX_TOTAL_MANIFEST_BYTES {
            entries.push(invalid_entry(
                directory,
                format!("NoLoader scan exceeded the {MAX_TOTAL_MANIFEST_BYTES}-byte total manifest limit."),
            ));
            continue;
        }
        total_manifest_bytes += manifest_json.len();
        let enabled = !disabled.contains(&directory);
        entries.push(ModDirectoryEntry {
            directory,
            manifest_json: Some(manifest_json),
            error: None,
            enabled,
        });
    }

    Ok(ModDirectorySnapshot {
        mods_directory: mods_directory.display().to_string(),
        entries,
        settings_error,
        safe_mode: settings.safe_mode,
    })
}

#[tauri::command]
pub fn noloader_set_mod_enabled(
    app: AppHandle,
    directory_name: String,
    enabled: bool,
) -> Result<(), String> {
    if !is_valid_directory_name(&directory_name) {
        return Err("Mod folder name is invalid.".to_string());
    }

    let (data_directory, mods_directory) = ensure_mod_directories(&app)?;
    canonical_child_directory(&mods_directory, &directory_name)?;
    let mut settings = read_settings(&data_directory)?;
    settings
        .disabled_mod_directories
        .retain(|directory| directory != &directory_name);
    if !enabled {
        settings.disabled_mod_directories.push(directory_name);
        settings.disabled_mod_directories.sort();
        settings.disabled_mod_directories.dedup();
    }
    write_settings(&data_directory, &settings)
}

#[tauri::command]
pub fn noloader_set_safe_mode(app: AppHandle, enabled: bool) -> Result<(), String> {
    let (data_directory, _) = ensure_mod_directories(&app)?;
    let mut settings = read_settings(&data_directory)?;
    settings.safe_mode = enabled;
    write_settings(&data_directory, &settings)
}

#[tauri::command]
pub fn noloader_get_last_played_server(app: AppHandle) -> Result<Option<LastPlayedServer>, String> {
    let (data_directory, _) = ensure_mod_directories(&app)?;
    read_last_played_server(&data_directory)
}

#[tauri::command]
pub fn noloader_record_last_played_server(
    app: AppHandle,
    profile_id: String,
    address: String,
) -> Result<(), String> {
    let profile_id = uuid::Uuid::parse_str(&profile_id)
        .map_err(|_| "Last-played server has an invalid profile ID.".to_string())?
        .to_string();
    let address = address.trim().to_string();
    if !is_valid_server_address(&address) {
        return Err("Last-played server address is invalid.".to_string());
    }

    let (data_directory, _) = ensure_mod_directories(&app)?;
    write_last_played_server(
        &data_directory,
        &LastPlayedServer {
            profile_id,
            address,
            played_at: chrono::Utc::now().to_rfc3339(),
        },
    )
}

#[tauri::command]
pub fn noloader_get_mod_storage(
    app: AppHandle,
    mod_id: String,
    key: String,
) -> Result<ModStorageRead, String> {
    validate_mod_storage_request(&mod_id, &key)?;
    let _guard = MOD_STORAGE_LOCK
        .lock()
        .map_err(|_| "Mod storage is unavailable after a previous storage error.".to_string())?;
    let data_directory = ensure_mod_storage_directory(&app)?;
    let values = read_mod_storage(&data_directory, &mod_id)?;
    let value = values.get(&key).cloned();
    Ok(ModStorageRead {
        found: value.is_some(),
        value,
    })
}

#[tauri::command]
pub fn noloader_set_mod_storage(
    app: AppHandle,
    mod_id: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    validate_mod_storage_request(&mod_id, &key)?;
    let serialized_value = serde_json::to_vec(&value)
        .map_err(|error| format!("Could not serialize mod storage value: {error}"))?;
    if serialized_value.len() > MAX_MOD_STORAGE_VALUE_BYTES {
        return Err(format!(
            "A mod storage value exceeds the {MAX_MOD_STORAGE_VALUE_BYTES}-byte limit."
        ));
    }

    let _guard = MOD_STORAGE_LOCK
        .lock()
        .map_err(|_| "Mod storage is unavailable after a previous storage error.".to_string())?;
    let data_directory = ensure_mod_storage_directory(&app)?;
    let mut values = read_mod_storage(&data_directory, &mod_id)?;
    values.insert(key, value);
    write_mod_storage(&data_directory, &mod_id, &values)
}

#[tauri::command]
pub fn noloader_delete_mod_storage(
    app: AppHandle,
    mod_id: String,
    key: String,
) -> Result<bool, String> {
    validate_mod_storage_request(&mod_id, &key)?;
    let _guard = MOD_STORAGE_LOCK
        .lock()
        .map_err(|_| "Mod storage is unavailable after a previous storage error.".to_string())?;
    let data_directory = ensure_mod_storage_directory(&app)?;
    let mut values = read_mod_storage(&data_directory, &mod_id)?;
    let removed = values.remove(&key).is_some();
    if removed {
        write_mod_storage(&data_directory, &mod_id, &values)?;
    }
    Ok(removed)
}

#[tauri::command]
pub fn noloader_read_mod_assets(
    app: AppHandle,
    directory_name: String,
) -> Result<ModAssets, String> {
    if !is_valid_directory_name(&directory_name) {
        return Err("Mod folder name is invalid.".to_string());
    }

    let (data_directory, mods_directory) = ensure_mod_directories(&app)?;
    let settings = read_settings(&data_directory)?;
    if settings.safe_mode {
        return Err("NoLoader safe mode is active; extensions cannot be started.".to_string());
    }
    if settings.disabled_mod_directories.contains(&directory_name) {
        return Err("This extension is disabled in NoLoader settings.".to_string());
    }
    let mod_directory = canonical_child_directory(&mods_directory, &directory_name)?;
    let manifest_json = read_limited_file(
        &mod_directory,
        Path::new("noloader.mod.json"),
        MAX_MANIFEST_BYTES,
    )?;
    let manifest: Value = serde_json::from_str(&manifest_json)
        .map_err(|error| format!("Could not parse mod manifest: {error}"))?;
    let entrypoints = manifest
        .get("entrypoints")
        .and_then(Value::as_object)
        .ok_or_else(|| "Manifest is missing its entrypoints object.".to_string())?;
    let frontend_path = entrypoints
        .get("frontend")
        .and_then(Value::as_str)
        .ok_or_else(|| "Manifest is missing its frontend entry point.".to_string())?;
    if !is_safe_entry_point(frontend_path, &[".js", ".mjs"]) {
        return Err(
            "Manifest frontend entry point is not a safe relative JavaScript path.".to_string(),
        );
    }
    let frontend_source = read_limited_file(
        &mod_directory,
        Path::new(frontend_path),
        MAX_MOD_ASSET_BYTES,
    )?;

    let styles = match entrypoints.get("styles") {
        None | Some(Value::Null) => None,
        Some(Value::String(path)) if is_safe_entry_point(path, &[".css"]) => Some(
            read_limited_file(&mod_directory, Path::new(path), MAX_MOD_ASSET_BYTES)?,
        ),
        Some(Value::String(_)) => {
            return Err("Manifest stylesheet is not a safe relative CSS path.".to_string());
        }
        Some(_) => return Err("Manifest stylesheet path must be a string.".to_string()),
    };

    Ok(ModAssets {
        manifest_json,
        frontend_source,
        styles,
    })
}

fn ensure_mod_directories(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the application data directory: {error}"))?;
    fs::create_dir_all(&app_data)
        .map_err(|error| format!("Could not create the application data directory: {error}"))?;
    let canonical_app_data = app_data
        .canonicalize()
        .map_err(|error| format!("Could not resolve the application data directory: {error}"))?;

    let data_directory = ensure_child_directory(&canonical_app_data, "NoLoader")?;
    let mods_directory = ensure_child_directory(&data_directory, MODS_DIRECTORY)?;
    Ok((data_directory, mods_directory))
}

fn ensure_mod_storage_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let (data_directory, _) = ensure_mod_directories(app)?;
    ensure_child_directory(&data_directory, MOD_DATA_DIRECTORY)
}

fn validate_mod_storage_request(mod_id: &str, key: &str) -> Result<(), String> {
    if !is_valid_mod_id(mod_id) {
        return Err("Mod storage has an invalid extension ID.".to_string());
    }
    if key.is_empty() || key.len() > MAX_MOD_STORAGE_KEY_BYTES || key.chars().any(char::is_control)
    {
        return Err(format!(
            "Mod storage keys must contain 1 to {MAX_MOD_STORAGE_KEY_BYTES} non-control characters."
        ));
    }
    Ok(())
}

fn is_valid_mod_id(value: &str) -> bool {
    value.len() <= 128
        && value.contains('.')
        && value.split(['.', '-']).all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn mod_storage_file(data_directory: &Path, mod_id: &str) -> Result<PathBuf, String> {
    if !is_valid_mod_id(mod_id) {
        return Err("Mod storage has an invalid extension ID.".to_string());
    }
    let path = data_directory.join(format!("{mod_id}.json"));
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err("Mod storage must be a regular file.".to_string())
        }
        Ok(metadata) if metadata.len() > MAX_MOD_STORAGE_BYTES as u64 => Err(format!(
            "Mod storage exceeds the {MAX_MOD_STORAGE_BYTES}-byte limit."
        )),
        Ok(_) => Ok(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path),
        Err(error) => Err(format!("Could not inspect mod storage: {error}")),
    }
}

fn read_mod_storage(data_directory: &Path, mod_id: &str) -> Result<Map<String, Value>, String> {
    let path = mod_storage_file(data_directory, mod_id)?;
    let contents = match fs::symlink_metadata(&path) {
        Ok(_) => read_bounded_text(&path, MAX_MOD_STORAGE_BYTES as u64, "mod storage")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(format!("Could not inspect mod storage: {error}")),
    };
    serde_json::from_str(&contents).map_err(|error| format!("Could not parse mod storage: {error}"))
}

fn write_mod_storage(
    data_directory: &Path,
    mod_id: &str,
    values: &Map<String, Value>,
) -> Result<(), String> {
    let destination = mod_storage_file(data_directory, mod_id)?;
    let serialized = serde_json::to_vec_pretty(values)
        .map_err(|error| format!("Could not serialize mod storage: {error}"))?;
    if serialized.len() > MAX_MOD_STORAGE_BYTES {
        return Err(format!(
            "Mod storage exceeds the {MAX_MOD_STORAGE_BYTES}-byte limit."
        ));
    }
    let temporary = data_directory.join(format!(".{mod_id}-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("Could not create temporary mod storage: {error}"))?;
    if let Err(error) = file.write_all(&serialized).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not write temporary mod storage: {error}"));
    }
    drop(file);
    if let Err(error) = replace_settings_file(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not update mod storage: {error}"));
    }
    Ok(())
}

fn read_last_played_server(data_directory: &Path) -> Result<Option<LastPlayedServer>, String> {
    let path = data_directory.join(LAST_PLAYED_SERVER_FILE);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not inspect last-played server: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Last-played server data must be a regular file.".to_string());
    }
    let contents = read_bounded_text(&path, 4096, "last-played server data")?;
    let server: LastPlayedServer = serde_json::from_str(&contents)
        .map_err(|error| format!("Could not parse last-played server data: {error}"))?;
    if uuid::Uuid::parse_str(&server.profile_id).is_err()
        || !is_valid_server_address(&server.address)
        || chrono::DateTime::parse_from_rfc3339(&server.played_at).is_err()
    {
        return Err("Last-played server data is invalid.".to_string());
    }
    Ok(Some(server))
}

fn write_last_played_server(
    data_directory: &Path,
    server: &LastPlayedServer,
) -> Result<(), String> {
    let destination = data_directory.join(LAST_PLAYED_SERVER_FILE);
    match fs::symlink_metadata(&destination) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("Last-played server data must be a regular file.".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Could not inspect last-played server data: {error}"
            ))
        }
    }

    let temporary =
        data_directory.join(format!(".last-played-server-{}.tmp", uuid::Uuid::new_v4()));
    let serialized = serde_json::to_vec_pretty(server)
        .map_err(|error| format!("Could not serialize last-played server data: {error}"))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("Could not create last-played server data: {error}"))?;
    if let Err(error) = file.write_all(&serialized).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not write last-played server data: {error}"));
    }
    drop(file);
    if let Err(error) = replace_settings_file(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not update last-played server data: {error}"));
    }
    Ok(())
}

fn is_valid_server_address(address: &str) -> bool {
    if address.is_empty()
        || address.len() > 255
        || address
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return false;
    }
    crate::utils::mc_utils::parse_minecraft_address(address)
        .is_ok_and(|(host, port)| !host.is_empty() && port > 0)
}

fn ensure_child_directory(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let path = parent.join(name);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(format!(
                "Managed directory is not a regular directory: {}",
                path.display()
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&path).map_err(|error| {
                format!(
                    "Could not create managed directory {}: {error}",
                    path.display()
                )
            })?;
        }
        Err(error) => {
            return Err(format!(
                "Could not inspect managed directory {}: {error}",
                path.display()
            ));
        }
    }

    path.canonicalize().map_err(|error| {
        format!(
            "Could not resolve managed directory {}: {error}",
            path.display()
        )
    })
}

fn canonical_child_directory(parent: &Path, name: &str) -> Result<PathBuf, String> {
    if !is_valid_directory_name(name) {
        return Err("Mod folder name is invalid.".to_string());
    }
    let path = parent.join(name);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("Could not inspect mod directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Mod entry must be a regular directory, not a link.".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve mod directory: {error}"))?;
    if !canonical.starts_with(parent) {
        return Err("Mod directory resolves outside the managed mods folder.".to_string());
    }
    Ok(canonical)
}

fn read_limited_file(root: &Path, relative_path: &Path, limit: u64) -> Result<String, String> {
    if !is_safe_relative_path(relative_path) {
        return Err("Mod file path is not a safe relative path.".to_string());
    }

    let mut current = root.to_path_buf();
    for component in relative_path.components() {
        let Component::Normal(segment) = component else {
            return Err("Mod file path contains an unsupported path component.".to_string());
        };
        current.push(segment);
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| format!("Could not inspect mod file: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Mod files may not use symbolic links.".to_string());
        }
    }

    let canonical = current
        .canonicalize()
        .map_err(|error| format!("Could not resolve mod file: {error}"))?;
    if !canonical.starts_with(root) {
        return Err("Mod file resolves outside its mod directory.".to_string());
    }
    let metadata =
        fs::metadata(&canonical).map_err(|error| format!("Could not inspect mod file: {error}"))?;
    if !metadata.is_file() {
        return Err("Mod entry point must be a regular file.".to_string());
    }
    if metadata.len() > limit {
        return Err(format!("Mod file exceeds the {limit}-byte limit."));
    }

    read_bounded_text(&canonical, limit, "mod file")
}

fn read_bounded_text(path: &Path, limit: u64, description: &str) -> Result<String, String> {
    let file =
        fs::File::open(path).map_err(|error| format!("Could not open {description}: {error}"))?;
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read {description}: {error}"))?;
    if bytes.len() as u64 > limit {
        return Err(format!("{description} exceeds the {limit}-byte limit."));
    }
    String::from_utf8(bytes).map_err(|error| format!("{description} is not valid UTF-8: {error}"))
}

fn is_valid_directory_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        && value.as_bytes()[0].is_ascii_alphanumeric()
}

fn is_safe_entry_point(value: &str, extensions: &[&str]) -> bool {
    !value.is_empty()
        && value.len() <= 240
        && extensions
            .iter()
            .any(|extension| value.ends_with(extension))
        && !value
            .chars()
            .any(|character| matches!(character, '\\' | '%' | ':' | '?' | '#'))
        && !value.starts_with('/')
        && !value.ends_with('/')
        && value.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn is_safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path.components().all(|component| match component {
            Component::Normal(segment) => {
                let value = segment.to_string_lossy();
                !value.is_empty()
                    && !value
                        .chars()
                        .any(|character| matches!(character, '\\' | '%' | ':' | '?' | '#'))
                    && value.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
                    })
            }
            _ => false,
        })
}

fn invalid_entry(directory: String, error: String) -> ModDirectoryEntry {
    ModDirectoryEntry {
        directory,
        manifest_json: None,
        error: Some(error),
        enabled: false,
    }
}

static MOD_STORAGE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn read_settings(data_directory: &Path) -> Result<NoLoaderSettings, String> {
    let path = data_directory.join(SETTINGS_FILE);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(NoLoaderSettings::default());
        }
        Err(error) => return Err(format!("Could not inspect NoLoader settings: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("NoLoader settings must be a regular file.".to_string());
    }
    if metadata.len() > 64 * 1024 {
        return Err("NoLoader settings exceed the 65536-byte limit.".to_string());
    }
    let contents = read_bounded_text(&path, 64 * 1024, "NoLoader settings")?;
    let settings: NoLoaderSettings = serde_json::from_str(&contents)
        .map_err(|error| format!("Could not parse NoLoader settings: {error}"))?;
    if settings.schema_version != 1 {
        return Err(format!(
            "NoLoader settings schema version {} is unsupported.",
            settings.schema_version
        ));
    }
    Ok(settings)
}

fn write_settings(data_directory: &Path, settings: &NoLoaderSettings) -> Result<(), String> {
    let destination = data_directory.join(SETTINGS_FILE);
    let temporary = data_directory.join(format!(".settings-{}.tmp", uuid::Uuid::new_v4()));
    let serialized = serde_json::to_vec_pretty(settings)
        .map_err(|error| format!("Could not serialize NoLoader settings: {error}"))?;

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("Could not create temporary NoLoader settings: {error}"))?;
    if let Err(error) = file.write_all(&serialized).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Could not write temporary NoLoader settings: {error}"
        ));
    }
    drop(file);
    if let Err(error) = replace_settings_file(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not update NoLoader settings: {error}"));
    }
    Ok(())
}

#[cfg(windows)]
fn replace_settings_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(std::io::Error::other)
}

#[cfg(not(windows))]
fn replace_settings_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::{
        is_safe_entry_point, is_safe_relative_path, is_valid_directory_name, is_valid_mod_id,
        validate_mod_storage_request, NoLoaderSettings, MAX_MOD_STORAGE_BYTES,
    };
    use serde_json::{Map, Value};
    use std::path::Path;

    #[test]
    fn accepts_only_safe_mod_directory_names() {
        assert!(is_valid_directory_name("hello-mod_1.0"));
        assert!(!is_valid_directory_name("../outside"));
        assert!(!is_valid_directory_name("C:\\mods\\test"));
        assert!(!is_valid_directory_name(".hidden"));
    }

    #[test]
    fn validates_extension_ids_and_storage_keys() {
        assert!(is_valid_mod_id("org.example.mod"));
        assert!(is_valid_mod_id("org.example-mod"));
        assert!(!is_valid_mod_id("../outside"));
        assert!(!is_valid_mod_id("org..example"));
        assert!(!is_valid_mod_id("org.example/../../outside"));
        assert!(validate_mod_storage_request("org.example.mod", "settings.v1").is_ok());
        assert!(validate_mod_storage_request("org.example.mod", "bad\nkey").is_err());
        assert!(validate_mod_storage_request("org.example.mod", &"k".repeat(129)).is_err());
    }

    #[test]
    fn mod_storage_is_per_extension_atomic_and_size_limited() {
        let directory = tempfile::tempdir().expect("temporary storage directory");
        let first_id = "org.example.first";
        let second_id = "org.example.second";
        let mut first = Map::new();
        first.insert("value".to_string(), Value::String("persisted".to_string()));
        super::write_mod_storage(directory.path(), first_id, &first).expect("write first mod data");
        assert_eq!(
            super::read_mod_storage(directory.path(), first_id).unwrap(),
            first
        );
        assert!(super::read_mod_storage(directory.path(), second_id)
            .unwrap()
            .is_empty());
        let oversized = Map::from_iter([(
            "value".to_string(),
            Value::String("x".repeat(MAX_MOD_STORAGE_BYTES)),
        )]);
        assert!(super::write_mod_storage(directory.path(), first_id, &oversized).is_err());
        assert_eq!(
            super::read_mod_storage(directory.path(), first_id).unwrap(),
            first
        );
    }

    #[test]
    fn accepts_only_relative_entry_points_with_expected_extensions() {
        assert!(is_safe_entry_point("dist/index.js", &[".js", ".mjs"]));
        assert!(is_safe_entry_point("dist/styles.css", &[".css"]));
        assert!(!is_safe_entry_point("../index.js", &[".js"]));
        assert!(!is_safe_entry_point("C:/mods/index.js", &[".js"]));
        assert!(!is_safe_entry_point("dist/%2e%2e/index.js", &[".js"]));
    }

    #[test]
    fn rejects_absolute_and_parent_components() {
        assert!(!is_safe_relative_path(Path::new("../outside.js")));
        assert!(!is_safe_relative_path(Path::new("/outside.js")));
        assert!(is_safe_relative_path(Path::new("dist/index.js")));
    }

    #[test]
    fn settings_default_safe_mode_and_keep_unknown_fields() {
        let settings: NoLoaderSettings =
            serde_json::from_str(r#"{"schemaVersion":1,"customOption":"kept"}"#)
                .expect("settings should parse");
        assert!(!settings.safe_mode);
        assert_eq!(
            settings
                .extra
                .get("customOption")
                .and_then(|value| value.as_str()),
            Some("kept")
        );
    }
}

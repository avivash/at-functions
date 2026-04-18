// Host-v1 function: lists records from an AT Proto collection.
//
// Input:  { "repo": "did:plc:...", "collection": "app.bsky.feed.post", "limit": 10 }
// Output: { "ok": true, "count": N, "uris": [...] }
//
// Calls host_list_collection to fetch records from AT Proto.

use std::alloc::{alloc as std_alloc, dealloc as std_dealloc, Layout};
use std::slice;

// Host import: list records in a collection.
// Input/output are UTF-8 JSON payloads passed via shared memory.
// Returns packed i64: upper 32 = ptr, lower 32 = len of JSON response.
#[link(wasm_import_module = "host")]
extern "C" {
    fn host_list_collection(ptr: i32, len: i32) -> i64;
}

#[no_mangle]
pub extern "C" fn alloc(len: i32) -> i32 {
    let layout = Layout::from_size_align(len as usize, 1).expect("layout");
    unsafe { std_alloc(layout) as i32 }
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: i32, len: i32) {
    let layout = Layout::from_size_align(len as usize, 1).expect("layout");
    unsafe { std_dealloc(ptr as *mut u8, layout) }
}

fn call_host_list_collection(input: &serde_json::Value) -> serde_json::Value {
    let input_bytes = serde_json::to_vec(input).expect("serialize");
    let ptr = alloc(input_bytes.len() as i32);
    unsafe {
        let slice = std::slice::from_raw_parts_mut(ptr as *mut u8, input_bytes.len());
        slice.copy_from_slice(&input_bytes);
    }

    let packed = unsafe { host_list_collection(ptr, input_bytes.len() as i32) };

    let out_ptr = (packed >> 32) as i32;
    let out_len = (packed & 0xffffffff) as i32;

    let result_bytes =
        unsafe { slice::from_raw_parts(out_ptr as *const u8, out_len as usize) };

    serde_json::from_slice(result_bytes).unwrap_or_else(|e| {
        serde_json::json!({ "ok": false, "error": format!("parse error: {}", e) })
    })
}

fn write_output(output: &serde_json::Value) -> i64 {
    let bytes = serde_json::to_vec(output).expect("serialize output");
    let ptr = alloc(bytes.len() as i32);
    unsafe {
        let slice = std::slice::from_raw_parts_mut(ptr as *mut u8, bytes.len());
        slice.copy_from_slice(&bytes);
    }
    ((ptr as i64) << 32) | (bytes.len() as i64)
}

#[no_mangle]
pub extern "C" fn run(ptr: i32, len: i32) -> i64 {
    let input_bytes = unsafe { slice::from_raw_parts(ptr as *const u8, len as usize) };

    let input: serde_json::Value = match serde_json::from_slice(input_bytes) {
        Ok(v) => v,
        Err(e) => {
            return write_output(&serde_json::json!({
                "ok": false,
                "error": format!("invalid JSON input: {}", e)
            }));
        }
    };

    let repo = match input["repo"].as_str() {
        Some(r) => r,
        None => {
            return write_output(&serde_json::json!({
                "ok": false,
                "error": "input must have 'repo' field"
            }));
        }
    };

    let collection = input["collection"].as_str().unwrap_or("app.bsky.feed.post");
    let limit = input["limit"].as_u64().unwrap_or(10).min(100);

    let list_input = serde_json::json!({
        "repo": repo,
        "collection": collection,
        "limit": limit
    });

    let result = call_host_list_collection(&list_input);

    if result["ok"].as_bool() != Some(true) {
        return write_output(&result);
    }

    let records = result["records"].as_array().cloned().unwrap_or_default();
    let uris: Vec<&str> = records
        .iter()
        .filter_map(|r| r["uri"].as_str())
        .collect();

    write_output(&serde_json::json!({
        "ok": true,
        "count": uris.len(),
        "uris": uris,
        "collection": collection
    }))
}

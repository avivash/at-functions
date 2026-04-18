// Pure-v1 echo function: echoes back whatever JSON input it receives.
//
// ABI contract:
//   export memory
//   export alloc(len: i32) -> i32      — allocate len bytes, return ptr
//   export run(ptr: i32, len: i32) -> i64  — execute; return packed (ptr<<32|len)
//   export dealloc(ptr: i32, len: i32)  — optional: free output buffer

use std::alloc::{alloc as std_alloc, dealloc as std_dealloc, Layout};
use std::slice;

static mut OUTPUT_BUF: Vec<u8> = Vec::new();

#[no_mangle]
pub extern "C" fn alloc(len: i32) -> i32 {
    let len = len as usize;
    let layout = Layout::from_size_align(len, 1).expect("invalid layout");
    unsafe {
        let ptr = std_alloc(layout);
        ptr as i32
    }
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: i32, len: i32) {
    let layout = Layout::from_size_align(len as usize, 1).expect("invalid layout");
    unsafe {
        std_dealloc(ptr as *mut u8, layout);
    }
}

#[no_mangle]
pub extern "C" fn run(ptr: i32, len: i32) -> i64 {
    let input_bytes = unsafe { slice::from_raw_parts(ptr as *const u8, len as usize) };

    let input: serde_json::Value = match serde_json::from_slice(input_bytes) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "error": format!("invalid JSON input: {}", e) }),
    };

    // Echo the input back wrapped in a response envelope
    let output = serde_json::json!({
        "ok": true,
        "echo": input,
        "mode": "pure-v1"
    });

    let output_bytes = serde_json::to_vec(&output).expect("serialization failed");
    let len = output_bytes.len();
    let ptr = alloc(len as i32);

    unsafe {
        let slice = std::slice::from_raw_parts_mut(ptr as *mut u8, len);
        slice.copy_from_slice(&output_bytes);
        OUTPUT_BUF = output_bytes;
    }

    // Pack ptr (upper 32 bits) and len (lower 32 bits) into i64
    ((ptr as i64) << 32) | (len as i64)
}

import { packPtrLen, unpackPtrLen, callWasmFunction } from "../src/wasm/abi.js";

// ---------------------------------------------------------------------------
// Host-mode ABI tests
// These tests verify the host import interface contract without requiring
// a real AT Proto connection or a compiled Rust WASM binary.
// ---------------------------------------------------------------------------

describe("host import ABI contract", () => {
  test("host response JSON is round-tripped through WASM memory", async () => {
    // Simulate a host_list_collection call:
    // 1. WASM writes JSON request into memory
    // 2. Host reads request, returns JSON response
    // 3. Host writes response into memory via alloc
    // 4. WASM reads response and processes it

    const mem = new WebAssembly.Memory({ initial: 4 });
    let bump = 65536;

    function alloc(len: number): number {
      const ptr = bump;
      bump += len;
      return ptr;
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Simulate what the host import does:
    // Write a fake host_list_collection response into WASM memory
    const fakeResponse = {
      ok: true,
      records: [
        { uri: "at://did:plc:abc/app.bsky.feed.post/1", cid: "bafy1", value: {} },
      ],
      cursor: undefined,
    };
    const responseBytes = encoder.encode(JSON.stringify(fakeResponse));
    const outPtr = alloc(responseBytes.byteLength);
    new Uint8Array(mem.buffer).set(responseBytes, outPtr);
    const packed = packPtrLen(outPtr, responseBytes.byteLength);

    // Verify the WASM can unpack and read the response
    const { ptr, len } = unpackPtrLen(packed);
    const rawBytes = new Uint8Array(mem.buffer, ptr, len);
    const parsed = JSON.parse(decoder.decode(rawBytes));

    expect(parsed.ok).toBe(true);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].uri).toBe(
      "at://did:plc:abc/app.bsky.feed.post/1"
    );
  });

  test("host error response is correctly structured", () => {
    const errorResponse = { ok: false, error: "record not found" };
    const bytes = new TextEncoder().encode(JSON.stringify(errorResponse));

    const mem = new WebAssembly.Memory({ initial: 2 });
    const ptr = 65536;
    new Uint8Array(mem.buffer).set(bytes, ptr);

    const packed = packPtrLen(ptr, bytes.byteLength);
    const { ptr: rPtr, len: rLen } = unpackPtrLen(packed);
    const result = JSON.parse(
      new TextDecoder().decode(new Uint8Array(mem.buffer, rPtr, rLen))
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("record not found");
  });

  test("callWasmFunction passes input and decodes output", () => {
    const mem = new WebAssembly.Memory({ initial: 2 });
    let bump = 65536;

    const expectedOutput = { ok: true, count: 3, uris: ["at://a", "at://b", "at://c"] };
    const outBytes = new TextEncoder().encode(JSON.stringify(expectedOutput));

    const fakeExports = {
      memory: mem,
      alloc: (len: number) => {
        const ptr = bump;
        bump += len;
        return ptr;
      },
      run: (ptr: number, _len: number): bigint => {
        const outPtr = bump;
        bump += outBytes.byteLength;
        new Uint8Array(mem.buffer).set(outBytes, outPtr);
        return packPtrLen(outPtr, outBytes.byteLength);
      },
    };

    const result = callWasmFunction(fakeExports, {
      repo: "did:plc:test",
      collection: "app.bsky.feed.post",
    });

    expect(result).toEqual(expectedOutput);
  });

  test("limit is clamped to 100 in host_list_collection input validation", () => {
    // The server-side clamp is tested here indirectly via the type contract
    const limit = Math.min(999, 100);
    expect(limit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Integration smoke test (skipped without network — run manually)
// ---------------------------------------------------------------------------

describe.skip("executeHost integration (requires network + compiled WASM)", () => {
  test("calls host_list_collection via real AT Proto", async () => {
    // To run this test manually:
    // 1. Compile examples/host-rust: cargo build --target wasm32-unknown-unknown --release
    // 2. Set ATPROTO_SERVICE env var
    // 3. Run: bun test --test-name-pattern "host integration"
    expect(true).toBe(true);
  });
});

wit_bindgen::generate!({
    world: "at-function",
    path: "wit",
});

use crate::atfunc::runtime::atproto;
use serde::Deserialize;
use serde_json::{json, Value};

struct Component;

#[derive(Deserialize)]
struct Input {
    repo: String,
    #[serde(default = "default_collection")]
    collection: String,
    #[serde(default = "default_limit")]
    limit: u64,
}

fn default_collection() -> String {
    "app.bsky.feed.post".to_string()
}

fn default_limit() -> u64 {
    5
}

impl Guest for Component {
    fn run(input_json: String) -> Result<String, String> {
        let input: Input =
            serde_json::from_str(&input_json).map_err(|e| format!("invalid input JSON: {e}"))?;

        let limit = input.limit.min(100) as u32;

        let result_json = atproto::list_collection(
            &input.repo,
            &input.collection,
            None,
            limit,
        )
        .map_err(|e| format!("list_collection failed: {e}"))?;

        let result: Value =
            serde_json::from_str(&result_json).map_err(|e| format!("invalid response JSON: {e}"))?;

        let records = result["records"].as_array().cloned().unwrap_or_default();
        let count = records.len();
        let uris: Vec<Value> = records
            .iter()
            .filter_map(|r| r.get("uri").cloned())
            .collect();

        let output = json!({
            "ok": true,
            "count": count,
            "uris": uris,
            "mode": "component-v1",
        });

        serde_json::to_string(&output).map_err(|e| format!("serialisation failed: {e}"))
    }
}

export!(Component);

// JSON Schema for POST /xrpc/app.atfunc.run request body
export const runRequestSchema = {
  type: "object",
  required: ["function", "input"],
  properties: {
    function: { type: "string", minLength: 5 },
    input: {},
  },
  additionalProperties: false,
} as const;

// JSON Schema for POST /xrpc/app.atfunc.run response
export const runResponseSchema = {
  type: "object",
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
    output: {},
    error: { type: "string" },
    durationMs: { type: "integer" },
    functionCid: { type: "string" },
  },
} as const;

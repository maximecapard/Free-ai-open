import { describe, expect, it } from "vitest";
import { redactString, redactTelemetryPayload } from "./index";

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

describe("redactString", () => {
  it("redacts email addresses", () => {
    expect(redactString("contact me at jane.doe@example.com")).toBe(
      "contact me at [REDACTED_EMAIL]"
    );
  });

  it("redacts phone numbers when they look like contact details", () => {
    expect(redactString("call +1 (415) 555-0132 after loading")).toBe(
      "call [REDACTED_PHONE] after loading"
    );
  });

  it("redacts known API-key-like secrets", () => {
    expect(redactString("key sk-abcdefghijklmnop")).toBe("key [REDACTED_SECRET]");
  });

  it("redacts key-value access and refresh tokens", () => {
    expect(redactString("access_token=access-token-value-12345")).toBe(
      "access_token=[REDACTED_SECRET]"
    );
    expect(redactString("refreshToken: refresh-token-value-12345")).toBe(
      "refreshToken=[REDACTED_SECRET]"
    );
  });

  it("redacts bearer tokens", () => {
    expect(redactString("Authorization: Bearer token-value-12345")).toBe(
      "Authorization: Bearer [REDACTED_SECRET]"
    );
  });

  it("redacts JWT-like tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

    expect(redactString(`token ${jwt}`)).toBe("token [REDACTED_JWT]");
  });

  it("replaces overly long strings instead of keeping a prefix", () => {
    const long = `private-${"a".repeat(600)}`;

    expect(redactString(long)).toBe("[REDACTED_LONG_STRING]");
  });
});

describe("redactTelemetryPayload", () => {
  it("replaces forbidden fields at the top level", () => {
    const result = redactTelemetryPayload({
      event: "chat_completed",
      prompt: "what is the weather",
      apiKey: "sk-should-not-leak",
    }) as Record<string, unknown>;

    expect(result.prompt).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.apiKey).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.event).toBe("chat_completed");
  });

  it("keeps allowed telemetry length and token metrics", () => {
    const result = redactTelemetryPayload({
      promptLength: 42,
      responseLength: 128,
      firstTokenMs: 300,
      tokensPerSecond: 18.5,
    }) as Record<string, unknown>;

    expect(result).toEqual({
      promptLength: 42,
      responseLength: 128,
      firstTokenMs: 300,
      tokensPerSecond: 18.5,
    });
  });

  it("recurses into nested objects and arrays", () => {
    const result = redactTelemetryPayload({
      items: [{ message: "hello there", contact: "a@b.com" }],
    }) as { items: Array<Record<string, unknown>> };

    expect(result.items[0].message).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.items[0].contact).toBe("[REDACTED_EMAIL]");
  });

  it("redacts forbidden field name variants at any nesting depth", () => {
    const result = redactTelemetryPayload({
      metadata: {
        prompt_text: "leaked prompt content",
        rawResponse: "leaked model answer",
        documentContent: "leaked document text",
        chatHistory: ["leaked chat history"],
      },
    }) as { metadata: Record<string, unknown> };

    expect(result.metadata.prompt_text).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.metadata.rawResponse).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.metadata.documentContent).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.metadata.chatHistory).toBe("[FORBIDDEN_FIELD_REMOVED]");
  });

  it("redacts access tokens, refresh tokens, and local file path fields", () => {
    const result = redactTelemetryPayload({
      auth: {
        accessToken: "access-token-value-12345",
        refresh_token: "refresh-token-value-12345",
        localFilePath: "C:\\Users\\Name\\private.txt",
      },
    }) as { auth: Record<string, unknown> };

    expect(result.auth.accessToken).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.auth.refresh_token).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.auth.localFilePath).toBe("[FORBIDDEN_FIELD_REMOVED]");
  });

  it("redacts runtime content-bearing field names before logging or telemetry", () => {
    const result = redactTelemetryPayload({
      runtime: {
        prompt: "private prompt",
        response: "private response",
        messages: ["private message"],
        conversation: "private conversation",
        document: "private document",
        fileContent: "private file content",
        userText: "private user text",
        inputText: "private input text",
        outputText: "private output text",
        chatHistory: "private chat history",
        modelId: "sample-general-light",
      },
    }) as { runtime: Record<string, unknown> };

    expect(result.runtime.prompt).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.response).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.messages).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.conversation).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.document).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.fileContent).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.userText).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.inputText).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.outputText).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.chatHistory).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.runtime.modelId).toBe("sample-general-light");
    expect(stringify(result)).not.toContain("private");
  });

  it("prevents telemetry payloads from containing prompt text", () => {
    const result = redactTelemetryPayload({ prompt: "my private prompt text" });

    expect(stringify(result)).not.toContain("my private prompt text");
  });

  it("prevents telemetry payloads from containing response text", () => {
    const result = redactTelemetryPayload({ response: "my private response text" });

    expect(stringify(result)).not.toContain("my private response text");
  });

  it("prevents telemetry payloads from containing document text", () => {
    const result = redactTelemetryPayload({
      documentContent: "confidential uploaded document text",
    });

    expect(stringify(result)).not.toContain("confidential uploaded document text");
  });

  it("prevents telemetry payloads from containing API keys", () => {
    const result = redactTelemetryPayload({
      errorCode: "api_key=secret-api-key-value",
    });

    expect(stringify(result)).not.toContain("secret-api-key-value");
  });

  it("prevents telemetry payloads from containing JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlLXVzZXIifQ.signaturePart12345";
    const result = redactTelemetryPayload({ errorCode: `token ${jwt}` });

    expect(stringify(result)).not.toContain(jwt);
  });

  it("prevents telemetry payloads from containing emails", () => {
    const result = redactTelemetryPayload({ errorCode: "contact jane.doe@example.com" });

    expect(stringify(result)).not.toContain("jane.doe@example.com");
  });

  it("passes through primitives and null or undefined unchanged", () => {
    expect(redactTelemetryPayload(null)).toBeNull();
    expect(redactTelemetryPayload(undefined)).toBeUndefined();
    expect(redactTelemetryPayload(42)).toBe(42);
    expect(redactTelemetryPayload(true)).toBe(true);
  });
});

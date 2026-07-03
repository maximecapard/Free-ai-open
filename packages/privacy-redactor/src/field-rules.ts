const ALLOWED_TELEMETRY_FIELD_NAMES = new Set([
  "appversion",
  "backend",
  "browserfamily",
  "contentlogged",
  "devicetier",
  "errorcode",
  "event",
  "fallbackattempted",
  "fallbackresult",
  "firsttokenms",
  "loadtimems",
  "modelid",
  "osfamily",
  "performancemode",
  "promptlength",
  "responselength",
  "severity",
  "task",
  "timestamp",
  "tokenspersecond",
]);

const FORBIDDEN_FIELD_NAMES = new Set([
  "apikey",
  "authorization",
  "chat",
  "chathistory",
  "conversation",
  "conversations",
  "document",
  "documentbody",
  "documentcontent",
  "documents",
  "documenttext",
  "email",
  "emailbody",
  "emailcontent",
  "emailtext",
  "filepath",
  "history",
  "localfilepath",
  "message",
  "messagecontent",
  "messages",
  "password",
  "prompt",
  "promptcontent",
  "prompttext",
  "rawprompt",
  "rawresponse",
  "refreshtoken",
  "response",
  "responsecontent",
  "responsetext",
  "secret",
  "token",
]);

const FORBIDDEN_FIELD_PARTS = [
  "accesstoken",
  "apikey",
  "bearertoken",
  "chathistory",
  "clientsecret",
  "documentcontent",
  "emailcontent",
  "localfilepath",
  "privatekey",
  "refreshtoken",
  "secretkey",
  "sessiontoken",
];

const CONTENT_FIELD_PATTERN =
  /(prompt|response|message|document|chat|email)(content|text|body|history|value|raw|data)$/;

export function normalizeFieldName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function shouldRedactField(key: string): boolean {
  const normalizedKey = normalizeFieldName(key);

  if (ALLOWED_TELEMETRY_FIELD_NAMES.has(normalizedKey)) {
    return false;
  }

  if (FORBIDDEN_FIELD_NAMES.has(normalizedKey)) {
    return true;
  }

  if (FORBIDDEN_FIELD_PARTS.some((part) => normalizedKey.includes(part))) {
    return true;
  }

  return CONTENT_FIELD_PATTERN.test(normalizedKey);
}

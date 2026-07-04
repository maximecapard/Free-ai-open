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
  "inputtext",
  "localfilepath",
  "message",
  "messagecontent",
  "messages",
  "outputtext",
  "password",
  "prompt",
  "promptcontent",
  "prompttext",
  "rawinput",
  "rawoutput",
  "rawprompt",
  "rawresponse",
  "refreshtoken",
  "response",
  "responsecontent",
  "responsetext",
  "secret",
  "token",
  "usertext",
]);

const FORBIDDEN_FIELD_PARTS = [
  "accesstoken",
  "apikey",
  "bearertoken",
  "chathistory",
  "clientsecret",
  "documentcontent",
  "emailcontent",
  "inputtext",
  "localfilepath",
  "outputtext",
  "privatekey",
  "refreshtoken",
  "secretkey",
  "sessiontoken",
  "usertext",
];

const CONTENT_FIELD_PATTERN =
  /(prompt|response|message|document|chat|email|user|input|output)(content|text|body|history|value|raw|data)$/;

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

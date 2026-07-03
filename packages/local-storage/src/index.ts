export interface LocalConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export async function ensureIndexedDbAvailable(): Promise<boolean> {
  return typeof indexedDB !== "undefined";
}

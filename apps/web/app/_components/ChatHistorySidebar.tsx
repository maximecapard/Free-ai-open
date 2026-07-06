"use client";

import { useState } from "react";
import type { ConversationMetadata } from "@free-ai-open/conversation-store";
import { ConversationExportImportControls } from "./ConversationExportImportControls";
import type { ConversationImportSummary } from "./ConversationExportImportControls";

export interface ChatHistorySidebarProps {
  conversations: ConversationMetadata[];
  activeConversationId: string | null;
  disabled: boolean;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExportActive: () => void;
  onExportAll: () => void;
  onImportFile: (file: File) => void;
  importSummary: ConversationImportSummary | null;
  onDismissImportSummary: () => void;
}

export function ChatHistorySidebar({
  conversations,
  activeConversationId,
  disabled,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  onExportActive,
  onExportAll,
  onImportFile,
  importSummary,
  onDismissImportSummary,
}: ChatHistorySidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  function startRename(conversation: ConversationMetadata) {
    setPendingDeleteId(null);
    setRenamingId(conversation.id);
    setRenameValue(conversation.title);
  }

  function commitRename(id: string) {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (trimmed) onRename(id, trimmed);
  }

  return (
    <aside style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <button type="button" onClick={onNewChat} disabled={disabled} style={{ padding: "10px 12px", borderRadius: 12 }}>
        + New chat
      </button>

      <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>Stored locally. This conversation stays on your device.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 420 }}>
        {conversations.length === 0 && <p style={{ fontSize: 13, opacity: 0.5, margin: 0 }}>No conversations yet.</p>}

        {conversations.map((conversation) => {
          const isActive = conversation.id === activeConversationId;
          const isRenaming = renamingId === conversation.id;
          const isPendingDelete = pendingDeleteId === conversation.id;

          return (
            <div
              key={conversation.id}
              style={{
                border: "1px solid #333",
                borderRadius: 10,
                padding: 8,
                background: isActive ? "#1c1c22" : "transparent",
              }}
            >
              {isRenaming ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitRename(conversation.id);
                  }}
                >
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => commitRename(conversation.id)}
                    style={{ width: "100%", padding: 4, borderRadius: 6 }}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  disabled={disabled}
                  title={conversation.title}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    fontSize: 14,
                    cursor: disabled ? "default" : "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {conversation.title}
                </button>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 12 }}>
                {isPendingDelete ? (
                  <>
                    <span style={{ opacity: 0.7 }}>Delete?</span>
                    <button type="button" onClick={() => onDelete(conversation.id)}>
                      Yes
                    </button>
                    <button type="button" onClick={() => setPendingDeleteId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={disabled} onClick={() => startRename(conversation)} style={{ opacity: 0.7 }}>
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setPendingDeleteId(conversation.id)}
                      style={{ opacity: 0.7 }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>
        Clearing your browser&apos;s site data for this app will delete this history.
      </p>

      <ConversationExportImportControls
        disabled={disabled}
        onExportActive={onExportActive}
        onExportAll={onExportAll}
        onImportFile={onImportFile}
        importSummary={importSummary}
        onDismissImportSummary={onDismissImportSummary}
      />
    </aside>
  );
}

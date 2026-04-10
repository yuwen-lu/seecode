import { create } from "zustand";
import type { ChatMessage, CanvasContext, ToolCallInfo } from "@/types/chat";
import type { DynamicTrace } from "@/types/graph";

const STORAGE_PREFIX = "seecode:chat:";
const MAX_PERSISTED = 50;
const MAX_API_HISTORY = 15;

interface ChatStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  highlights: Set<string>;
  canvasContext: CanvasContext | null;
  repoKey: string | null;
  isOpen: boolean;

  activeTrace: DynamicTrace | null;
  hoveredStepIndex: number | null;
  pendingToolCalls: ToolCallInfo[];

  setRepoKey: (key: string) => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastAssistant: (content: string) => void;
  finalizeLastAssistant: (fileReferences?: ChatMessage["fileReferences"], trace?: DynamicTrace, toolCalls?: ToolCallInfo[]) => void;
  setStreaming: (v: boolean) => void;
  setHighlights: (ids: Set<string>) => void;
  clearHighlights: () => void;
  setCanvasContext: (ctx: CanvasContext) => void;
  clearMessages: () => void;
  loadFromStorage: (repoKey: string) => void;
  setOpen: (v: boolean) => void;
  toggleOpen: () => void;

  setActiveTrace: (trace: DynamicTrace | null) => void;
  setHoveredStep: (index: number | null) => void;
  addPendingToolCall: (tc: ToolCallInfo) => void;
  clearPendingToolCalls: () => void;

  apiHistory: () => Pick<ChatMessage, "role" | "content">[];
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isStreaming: false,
  highlights: new Set(),
  canvasContext: null,
  repoKey: null,
  isOpen: false,
  activeTrace: null,
  hoveredStepIndex: null,
  pendingToolCalls: [],

  setRepoKey: (key) => {
    set({ repoKey: key });
    get().loadFromStorage(key);
  },

  addMessage: (msg) => {
    set((s) => {
      const next = [...s.messages, msg];
      persist(s.repoKey, next);
      return { messages: next };
    });
  },

  updateLastAssistant: (content) => {
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content };
      }
      return { messages: msgs };
    });
  },

  finalizeLastAssistant: (fileReferences, trace, toolCalls) => {
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, fileReferences, trace, toolCalls };
      }
      persist(s.repoKey, msgs);
      return { messages: msgs };
    });
  },

  setStreaming: (v) => set({ isStreaming: v }),
  setHighlights: (ids) => set({ highlights: ids }),
  clearHighlights: () => set({ highlights: new Set() }),
  setCanvasContext: (ctx) => set({ canvasContext: ctx }),

  setOpen: (v) => set({ isOpen: v }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setActiveTrace: (trace) => set({ activeTrace: trace }),
  setHoveredStep: (index) => set({ hoveredStepIndex: index }),
  addPendingToolCall: (tc) =>
    set((s) => ({ pendingToolCalls: [...s.pendingToolCalls, tc] })),
  clearPendingToolCalls: () => set({ pendingToolCalls: [] }),

  clearMessages: () => {
    const { repoKey } = get();
    if (repoKey) {
      try { localStorage.removeItem(STORAGE_PREFIX + repoKey); } catch {}
    }
    set({ messages: [], highlights: new Set(), activeTrace: null, hoveredStepIndex: null });
  },

  loadFromStorage: (repoKey) => {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + repoKey);
      if (raw) {
        const msgs: ChatMessage[] = JSON.parse(raw);
        set({ messages: msgs });
        return;
      }
    } catch {}
    set({ messages: [] });
  },

  apiHistory: () => {
    const { messages } = get();
    return messages
      .filter((m) => m.role !== "system")
      .slice(-MAX_API_HISTORY)
      .map(({ role, content }) => ({ role, content }));
  },
}));

function persist(repoKey: string | null, messages: ChatMessage[]) {
  if (!repoKey) return;
  try {
    const trimmed = messages.slice(-MAX_PERSISTED);
    localStorage.setItem(STORAGE_PREFIX + repoKey, JSON.stringify(trimmed));
  } catch {}
}

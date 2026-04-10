"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, X, FileText, Loader2, MessageCircle, Minus, Plus, ChevronDown, ChevronRight, ArrowRight, Search } from "lucide-react";
import Markdown from "react-markdown";
import { useChatStore } from "@/store/chat-store";
import { buildFileIndex } from "@/lib/chat-references";
import type { ArchModule, NodeCategory, DynamicTrace } from "@/types/graph";
import type { ChatMessage, FileReference, ToolCallInfo } from "@/types/chat";

const STARTER_QUESTIONS = [
  "What does this codebase do?",
  "Walk me through the main data flow",
  "What are the key entry points?",
  "How are the modules connected?",
];

const TOOL_LABELS: Record<string, string> = {
  get_module: "Inspecting module",
  get_connections: "Checking connections",
  get_traces: "Reading traces",
  read_file: "Reading file",
  search_code: "Searching code",
};

interface ChatPanelProps {
  modules: ArchModule[];
  onFileClick: (filePath: string, moduleId: string, category: NodeCategory) => void;
}

export function ChatPanel({ modules, onFileClick }: ChatPanelProps) {
  const {
    messages, isStreaming, isOpen,
    addMessage, updateLastAssistant, finalizeLastAssistant,
    setStreaming, setHighlights, clearHighlights, setOpen, toggleOpen,
    setActiveTrace, addPendingToolCall, clearPendingToolCalls, pendingToolCalls,
  } = useChatStore();
  const canvasContext = useChatStore((s) => s.canvasContext);

  const [input, setInput] = useState("");
  const [height, setHeight] = useState(() => typeof window !== "undefined" ? Math.round(window.innerHeight * 0.7) : 500);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isResizing = useRef(false);

  const fileIndex = useMemo(() => buildFileIndex(modules), [modules]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingToolCalls]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        if (!isOpen) setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, setOpen]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startY = e.clientY;
    const startHeight = height;

    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      const delta = startY - e.clientY;
      setHeight(Math.max(250, Math.min(window.innerHeight - 100, startHeight + delta)));
    }

    function onMouseUp() {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [height]);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isStreaming || !canvasContext) return;

    setInput("");
    if (!isOpen) setOpen(true);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now(),
    };
    addMessage(userMsg);

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "assistant", content: "", timestamp: Date.now(),
    };
    addMessage(assistantMsg);
    setStreaming(true);
    clearHighlights();
    clearPendingToolCalls();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const apiHistory = useChatStore.getState().apiHistory();
      const history = apiHistory.slice(0, -2);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, context: canvasContext, history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Chat request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      const collectedToolCalls: ToolCallInfo[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.text) {
                fullText += data.text;
                updateLastAssistant(fullText);
              }

              if (data.tool !== undefined && data.input !== undefined && data.summary === undefined) {
                const tc: ToolCallInfo = { tool: data.tool, input: data.input };
                collectedToolCalls.push(tc);
                addPendingToolCall(tc);
              }

              if (data.tool !== undefined && data.summary !== undefined) {
                const last = collectedToolCalls[collectedToolCalls.length - 1];
                if (last && last.tool === data.tool) {
                  last.summary = data.summary;
                }
              }

              if (data.content !== undefined && data.refs) {
                const fileRefs = extractRefsFromModuleIds(data.refs, modules);
                const trace: DynamicTrace | undefined = data.trace ?? undefined;
                finalizeLastAssistant(fileRefs, trace, collectedToolCalls);
                setHighlights(new Set<string>(fileRefs.map((r: FileReference) => r.moduleId)));
                if (trace) {
                  setActiveTrace(trace);
                }
                clearPendingToolCalls();
              }

              if (data.error) updateLastAssistant(`Error: ${data.error}`);
            } catch {}
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        updateLastAssistant(`Error: ${(err as Error).message}`);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, canvasContext, isOpen, modules, addMessage, updateLastAssistant, finalizeLastAssistant, setStreaming, setHighlights, clearHighlights, setOpen, setActiveTrace, addPendingToolCall, clearPendingToolCalls]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === "Escape") { inputRef.current?.blur(); }
  };

  const clearChat = () => {
    useChatStore.getState().clearMessages();
    clearHighlights();
    setActiveTrace(null);
  };

  const contextLabel = canvasContext?.selected
    ? canvasContext.selected.name
    : canvasContext?.selectedComponent
      ? canvasContext.selectedComponent.label
      : null;

  return (
    <>
      {!isOpen && (
        <button
          onClick={toggleOpen}
          className="fixed bottom-5 right-5 z-40 p-3 rounded-full bg-surface-1 border border-border text-text-secondary hover:text-foreground hover:border-border-strong transition-all cursor-pointer"
        >
          <MessageCircle size={18} />
        </button>
      )}

      {isOpen && (
        <div
          className="fixed bottom-4 right-4 z-40 w-[420px] flex flex-col rounded-xl border border-border bg-surface-1/95 backdrop-blur-sm shadow-2xl shadow-black/40 overflow-hidden"
          style={{ height }}
        >
          <div
            className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-10"
            onMouseDown={onResizeMouseDown}
          />

          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <span className="text-xs font-medium text-text-secondary truncate">
              Chat
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              {messages.length > 0 && (
                <button onClick={clearChat} className="p-1 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer" title="New chat">
                  <Plus size={14} />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer" title="Minimize">
                <Minus size={14} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto subtle-scrollbar px-4 py-3">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center gap-5">
                <p className="text-text-tertiary text-xs text-center leading-relaxed">
                  Ask questions about the codebase.<br />
                  Select a module on the canvas for context.
                </p>
                <div className="flex flex-col gap-1.5 w-full max-w-[300px]">
                  {STARTER_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      onMouseEnter={() => setInput(q)}
                      onMouseLeave={() => setInput("")}
                      className="text-left text-xs text-text-secondary hover:text-foreground px-3 py-2 rounded-full border border-border hover:border-border-strong hover:bg-surface-2/80 transition-colors cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, idx) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                fileIndex={fileIndex}
                onFileClick={onFileClick}
                modules={modules}
                isStreaming={isStreaming && idx === messages.length - 1 && msg.role === "assistant"}
                isLastAssistant={idx === messages.length - 1 && msg.role === "assistant"}
                pendingToolCalls={isStreaming && idx === messages.length - 1 && msg.role === "assistant" ? pendingToolCalls : undefined}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-3 py-2.5 shrink-0">
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-1.5 focus-within:border-border-strong transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={contextLabel ? `Ask about ${contextLabel}...` : "Ask about this codebase..."}
                rows={1}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-text-tertiary resize-none outline-none overflow-y-auto py-1"
                style={{ lineHeight: "1.5", maxHeight: `${1.5 * 14 * 3 + 8}px` }}
              />
              {isStreaming ? (
                <button onClick={() => abortRef.current?.abort()} className="shrink-0 p-1 rounded text-text-secondary hover:text-foreground transition-colors cursor-pointer">
                  <X size={15} />
                </button>
              ) : (
                <button onClick={() => sendMessage()} disabled={!input.trim() || !canvasContext}
                  className="shrink-0 p-1 rounded text-text-secondary hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer">
                  <Send size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// --- Exploration section (collapsible tool calls) ---

function ExplorationSection({ toolCalls, isLive }: { toolCalls: ToolCallInfo[]; isLive: boolean }) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!isLive && toolCalls.length > 0) setExpanded(false);
  }, [isLive, toolCalls.length]);

  if (toolCalls.length === 0) return null;

  return (
    <div className="mb-2 rounded-lg border border-border/60 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-text-secondary hover:text-text-primary bg-surface-2/30 transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Search size={10} className={isLive ? "animate-pulse" : ""} />
        <span className="font-medium">
          {isLive ? "Exploring codebase..." : `Explored ${toolCalls.length} sources`}
        </span>
        {isLive && <Loader2 size={10} className="ml-auto animate-spin" />}
      </button>
      {expanded && (
        <div className="px-2.5 py-1.5 space-y-0.5 bg-surface-2/15">
          {toolCalls.map((tc, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] text-text-tertiary font-mono">
              <span className="text-text-secondary">{TOOL_LABELS[tc.tool] ?? tc.tool}</span>
              <span className="truncate opacity-70">
                {formatToolInput(tc)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatToolInput(tc: ToolCallInfo): string {
  if (tc.input.moduleId) return String(tc.input.moduleId);
  if (tc.input.filePath) return String(tc.input.filePath);
  if (tc.input.pattern) return `"${tc.input.pattern}"`;
  return "";
}

// --- Trace card ---

function TraceCard({ trace, modules, onFileClick }: {
  trace: DynamicTrace;
  modules: ArchModule[];
  onFileClick: (filePath: string, moduleId: string, category: NodeCategory) => void;
}) {
  const { setHoveredStep } = useChatStore();

  return (
    <div className="mt-3 rounded-lg border border-accent/30 overflow-hidden">
      <div className="px-3 py-1.5 bg-accent/8 border-b border-accent/20">
        <span className="text-[11px] font-medium text-accent">
          Trace: {trace.name}
        </span>
      </div>
      <div className="divide-y divide-border/40">
        {trace.steps.map((step, i) => {
          const mod = modules.find((m) => m.id === step.moduleId);
          return (
            <div
              key={i}
              className="px-3 py-2 hover:bg-accent/5 transition-colors cursor-default group"
              onMouseEnter={() => setHoveredStep(i)}
              onMouseLeave={() => setHoveredStep(null)}
              onClick={() => {
                if (mod && mod.files.length > 0) {
                  onFileClick(mod.files[0], mod.id, mod.category);
                }
              }}
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent text-[10px] font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-xs font-medium text-foreground truncate">
                  {mod?.name ?? step.moduleId}
                </span>
              </div>
              <p className="text-[11px] text-text-secondary mt-0.5 ml-7 leading-relaxed">
                {step.summary}
              </p>
              {step.files && step.files.length > 0 && (
                <div className="ml-7 mt-1 flex flex-wrap gap-1">
                  {step.files.map((f) => (
                    <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-surface-2/60 text-text-tertiary font-mono truncate max-w-[180px]">
                      {f.split("/").pop()}
                    </span>
                  ))}
                </div>
              )}
              {step.dataOut && (
                <div className="ml-7 mt-1 flex items-center gap-1 text-[10px] text-accent/70">
                  <ArrowRight size={10} />
                  <span>{step.dataOut}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Message rendering ---

function MessageBubble({ message, fileIndex, onFileClick, modules, isStreaming, isLastAssistant, pendingToolCalls }: {
  message: ChatMessage;
  fileIndex: Map<string, { moduleId: string; moduleName: string; category: NodeCategory }>;
  onFileClick: (filePath: string, moduleId: string, category: NodeCategory) => void;
  modules: ArchModule[];
  isStreaming: boolean;
  isLastAssistant: boolean;
  pendingToolCalls?: ToolCallInfo[];
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] px-3 py-2 rounded-xl bg-accent/15 text-sm text-foreground whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  const toolCalls = pendingToolCalls ?? message.toolCalls ?? [];
  const displayContent = message.content
    .replace(/<!--refs:\s*\[[\s\S]*?\]\s*-->/g, "")
    .replace(/<!--trace:\s*\{[\s\S]*?\}\s*-->/g, "")
    .trim();

  return (
    <div className="mb-4">
      <ExplorationSection toolCalls={toolCalls} isLive={!!pendingToolCalls && isStreaming} />

      {displayContent && (
        <div className="chat-markdown text-sm text-foreground/90 leading-relaxed">
          <Markdown
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                const isBlock = String(children).includes("\n");
                if (isBlock) {
                  const lang = match?.[1] || "";
                  const fileEntry = fileIndex.get(lang);
                  return (
                    <div className="my-2 rounded-lg border border-border overflow-hidden">
                      <div className="flex items-center px-3 py-1.5 bg-surface-2/50 border-b border-border">
                        {fileEntry ? (
                          <button onClick={() => onFileClick(lang, fileEntry.moduleId, fileEntry.category)}
                            className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent/80 transition-colors">
                            <FileText size={14} />{lang}
                          </button>
                        ) : (
                          <span className="text-[11px] text-text-tertiary">{lang || "code"}</span>
                        )}
                      </div>
                      <pre className="px-3 py-2 overflow-x-auto text-[11px] leading-relaxed font-mono text-foreground/80">
                        <code>{children}</code>
                      </pre>
                    </div>
                  );
                }
                return (
                  <code className="px-1 py-0.5 rounded bg-surface-2 text-[12px] font-mono" {...props}>
                    {children}
                  </code>
                );
              },
              p({ children }) { return <p className="mb-2 last:mb-0">{children}</p>; },
              ul({ children }) { return <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>; },
              ol({ children }) { return <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>; },
              li({ children }) { return <li className="pl-0.5">{children}</li>; },
              h1({ children }) { return <h3 className="text-sm font-semibold mt-3 mb-1">{children}</h3>; },
              h2({ children }) { return <h3 className="text-sm font-semibold mt-3 mb-1">{children}</h3>; },
              h3({ children }) { return <h4 className="text-[13px] font-semibold mt-2 mb-1">{children}</h4>; },
              strong({ children }) { return <strong className="font-semibold text-foreground">{children}</strong>; },
              a({ href, children }) { return <a href={href} className="text-accent hover:underline" target="_blank" rel="noreferrer">{children}</a>; },
              blockquote({ children }) { return <blockquote className="border-l-2 border-accent/30 pl-3 my-2 text-text-secondary italic">{children}</blockquote>; },
            }}
          >
            {displayContent}
          </Markdown>
          {isStreaming && !displayContent && <Loader2 size={14} className="inline-block ml-1 animate-spin text-text-tertiary" />}
        </div>
      )}

      {!isStreaming && isLastAssistant && !displayContent && (
        <Loader2 size={14} className="animate-spin text-text-tertiary" />
      )}

      {message.trace && (
        <TraceCard trace={message.trace} modules={modules} onFileClick={onFileClick} />
      )}
    </div>
  );
}

function extractRefsFromModuleIds(moduleIds: string[], modules: ArchModule[]): FileReference[] {
  const refs: FileReference[] = [];
  for (const id of moduleIds) {
    const mod = modules.find((m) => m.id === id);
    if (mod && mod.files.length > 0) {
      refs.push({ filePath: mod.files[0], moduleId: mod.id, moduleName: mod.name, category: mod.category });
    }
  }
  return refs;
}

import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { fetchPlanContent, planChatURL } from "../api";
import { SendIcon } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PlanEditorProps {
  planId: number;
  planTitle: string;
  open: boolean;
  onClose: () => void;
}

export function PlanEditor({ planId, planTitle, open, onClose }: PlanEditorProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load initial plan content
  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setError(null);
    setMessages([]);
    setStreamingContent("");

    fetchPlanContent(planId)
      .then(setContent)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [planId, open]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setSending(true);
    setStreamingContent("");

    try {
      const response = await fetch(planChatURL(planId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "text") {
              assistantContent += data.content;
              setStreamingContent(assistantContent);
            } else if (data.type === "plan_updated") {
              // Refresh plan content
              fetchPlanContent(planId)
                .then(setContent)
                .catch(console.error);
            } else if (data.type === "done") {
              // Finalize message
              if (assistantContent) {
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: assistantContent },
                ]);
              }
              setStreamingContent("");
            } else if (data.type === "error") {
              console.error("Chat error:", data.content);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${e.message}` },
      ]);
    } finally {
      setSending(false);
      setStreamingContent("");
    }
  }, [input, sending, planId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="!max-w-[calc(100%-1rem)] sm:!max-w-[95vw] w-full sm:w-[1400px] h-[calc(100%-2rem)] sm:h-[90vh] flex flex-col gap-0 p-0 overflow-hidden"
        showCloseButton={true}
      >
        <DialogHeader className="px-4 py-3 sm:px-6 sm:py-4 border-b shrink-0">
          <DialogTitle className="truncate">Edit Plan: {planTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 flex flex-col sm:flex-row overflow-hidden">
          {/* Chat panel (left) */}
          <div className="w-full sm:w-[400px] flex flex-col border-b sm:border-b-0 sm:border-r h-[40%] sm:h-full">
            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && !streamingContent && (
                <p className="text-muted-foreground text-sm">
                  Send a message to edit the plan. You can ask to add sections, modify content, or restructure the plan.
                </p>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm ${
                    msg.role === "user"
                      ? "bg-muted rounded-lg p-3 ml-8"
                      : "text-muted-foreground"
                  }`}
                >
                  <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                </div>
              ))}
              {streamingContent && (
                <div className="text-sm text-muted-foreground">
                  <pre className="whitespace-pre-wrap font-sans">{streamingContent}</pre>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            {/* Chat input */}
            <div className="p-4 border-t">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask to edit the plan..."
                  className="flex-1 min-h-[60px] max-h-[120px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  disabled={sending}
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  className="shrink-0"
                >
                  <SendIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Plan viewer (right) */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 h-[60%] sm:h-full">
            {loading && <p className="text-muted-foreground">Loading plan...</p>}
            {error && <p className="text-red-500">{error}</p>}
            {!loading && !error && content && (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            )}
            {!loading && !error && !content && (
              <p className="text-muted-foreground">
                No plan yet. Send a message to create one.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

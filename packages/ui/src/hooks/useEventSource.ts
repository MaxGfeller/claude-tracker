import { useState, useEffect, useRef } from "react";

export function useEventSource(url: string | null) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!url) {
      setLines([]);
      setConnected(false);
      return;
    }

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.addEventListener("log", (e) => {
      setLines((prev) => [...prev, e.data]);
    });

    es.addEventListener("done", () => {
      setConnected(false);
      es.close();
    });

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [url]);

  return { lines, connected };
}

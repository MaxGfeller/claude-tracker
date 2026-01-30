import { useState } from "react";
import { Header } from "./components/Header";
import { Dashboard } from "./components/Dashboard";

export default function App() {
  const [showCompleted, setShowCompleted] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        showCompleted={showCompleted}
        onToggleCompleted={() => setShowCompleted((v) => !v)}
      />
      <main className="flex-1 px-6 py-6 overflow-hidden">
        <Dashboard showCompleted={showCompleted} />
      </main>
    </div>
  );
}

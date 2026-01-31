import { useState } from "react";
import { Header } from "./components/Header";
import { Dashboard } from "./components/Dashboard";

export default function App() {
  const [showCompleted, setShowCompleted] = useState(true);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
    new Set()
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        showCompleted={showCompleted}
        onToggleCompleted={() => setShowCompleted((v) => !v)}
        selectedProjects={selectedProjects}
        onSelectedProjectsChange={setSelectedProjects}
      />
      <main className="flex-1 px-3 py-3 sm:px-6 sm:py-6 overflow-hidden">
        <Dashboard
          showCompleted={showCompleted}
          selectedProjects={selectedProjects}
        />
      </main>
    </div>
  );
}

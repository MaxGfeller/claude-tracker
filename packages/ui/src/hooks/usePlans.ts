import { useState, useEffect, useCallback } from "react";
import { fetchPlans, type Plan } from "../api";

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPlans();
      setPlans(data);
    } catch (e) {
      console.error("Failed to fetch plans:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { plans, loading, refresh };
}

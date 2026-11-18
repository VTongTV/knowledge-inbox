import { useEffect, useState } from "react";

export function Greeting() {
  const [now, setNow] = useState(() => new Date());

  // the greeting tracks the computer clock instead of mount time.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="greeting">
      <span className="greeting-dot" aria-hidden />
      <span>Good {part}</span>
      <span className="greeting-time">{time}</span>
    </div>
  );
}

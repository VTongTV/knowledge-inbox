export function Greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return (
    <div className="greeting">
      <span className="greeting-dot" aria-hidden />
      <span>Good {part}</span>
    </div>
  );
}

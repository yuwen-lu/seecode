"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="w-8 h-8" />;
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-foreground hover:border-accent/40 transition-colors cursor-pointer overflow-hidden"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <div
        className="absolute transition-all duration-300 ease-in-out"
        style={{
          transform: isDark ? "translateX(0) rotate(0)" : "translateX(-30px) rotate(-90deg)",
          opacity: isDark ? 1 : 0,
        }}
      >
        <Moon size={14} />
      </div>
      <div
        className="absolute transition-all duration-300 ease-in-out"
        style={{
          transform: isDark ? "translateX(30px) rotate(90deg)" : "translateX(0) rotate(0)",
          opacity: isDark ? 0 : 1,
        }}
      >
        <Sun size={14} />
      </div>
    </button>
  );
}

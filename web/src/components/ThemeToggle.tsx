"use client";

/** Flips data-theme on <html>; charts listen for the "themechange" event to re-read CSS colors. */
export function ThemeToggle() {
  return (
    <button
      className="theme-toggle"
      onClick={() => {
        const root = document.documentElement;
        const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        root.dataset.theme = dark ? "light" : "dark";
        window.dispatchEvent(new Event("themechange"));
      }}
    >
      Theme
    </button>
  );
}

"use client";
import Chart from "chart.js/auto";
import type { ChartConfiguration } from "chart.js";
import { useEffect, useRef, useState } from "react";
import { css } from "@/lib/format";

export type ThemeColors = { ink: string; muted: string; line: string; s: string[] };

/** Chart.js canvas. `build` receives resolved theme colors and is re-run when the theme flips. */
export function ChartCanvas({ build, height = 270 }: { build: (c: ThemeColors) => ChartConfiguration; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState(0);
  useEffect(() => {
    const on = () => setTheme((t) => t + 1);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("themechange", on);
    mq.addEventListener("change", on);
    return () => { window.removeEventListener("themechange", on); mq.removeEventListener("change", on); };
  }, []);
  useEffect(() => {
    if (!ref.current) return;
    const colors: ThemeColors = { ink: css("--ink"), muted: css("--muted"), line: css("--line"), s: [0, 1, 2, 3, 4, 5].map((k) => css(`--s${k}`)) };
    Chart.defaults.color = colors.muted;
    Chart.defaults.borderColor = colors.line;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const chart = new Chart(ref.current, build(colors));
    return () => chart.destroy();
  }, [build, theme]);
  return <div className="chart-box" style={{ height }}><canvas ref={ref} /></div>;
}

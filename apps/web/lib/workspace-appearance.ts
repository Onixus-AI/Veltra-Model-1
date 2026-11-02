export type Appearance = {
  version: 1;
  accent: "cyan" | "magenta" | "lemon" | "purple" | "lime" | "orange" | "red";
  density: "comfortable" | "compact";
  theme: "dark" | "light";
};
export const defaultAppearance: Appearance = {
  version: 1,
  accent: "cyan",
  density: "comfortable",
  theme: "dark",
};
export function readAppearance(value: unknown): Appearance {
  if (!value || typeof value !== "object") return { ...defaultAppearance };
  const saved = value as Record<string, unknown>;
  const accent =
    saved.accent === "violet"
      ? "purple"
      : saved.accent === "emerald"
        ? "lime"
        : saved.accent;
  return {
    version: 1,
    accent: ([
      "cyan",
      "magenta",
      "lemon",
      "purple",
      "lime",
      "orange",
      "red",
    ].includes(String(accent))
      ? accent
      : "cyan") as Appearance["accent"],
    density: saved.density === "compact" ? "compact" : "comfortable",
    theme: saved.theme === "light" ? "light" : "dark",
  };
}

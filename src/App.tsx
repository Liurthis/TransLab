import { BookOpenText, Gauge, History, Layers } from "lucide-react";
import { useHashRoute } from "./lib/router";
import { RUBRIC } from "./data/rubric";
import { MaterialsPage } from "./pages/Materials";
import { PracticePage } from "./pages/Practice";
import { ResultsPage } from "./pages/Results";
import { RubricPage } from "./pages/Rubric";

const NAV = [
  { path: "/", label: "材料库", icon: Layers },
  { path: "/results", label: "练习记录", icon: History },
  { path: "/rubric", label: "评分规则", icon: Gauge },
];

export default function App() {
  const route = useHashRoute();
  const [section, rawParam] = route.split("/").filter(Boolean);
  const [materialId, query = ""] = (rawParam ?? "").split("?");

  const view =
    section === "practice" ? (
      // key 让切换材料或换一条记录时重新挂载，否则会留着上一篇的译文与评分。
      <PracticePage
        key={`${materialId}|${new URLSearchParams(query).get("saved") ?? ""}`}
        materialId={materialId}
        savedAt={new URLSearchParams(query).get("saved") ?? undefined}
      />
    ) : section === "results" ? (
      <ResultsPage />
    ) : section === "rubric" ? (
      <RubricPage />
    ) : (
      <MaterialsPage />
    );

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <a href="#/" className="flex items-center gap-2">
            <BookOpenText className="size-4 text-primary" />
            <span className="text-sm font-semibold tracking-tight">TransLab</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              翻译训练与评估
            </span>
          </a>

          <nav className="flex items-center gap-1">
            {NAV.map(({ path, label, icon: Icon }) => {
              const active = path === "/" ? !section : section === path.slice(1);
              return (
                <a
                  key={path}
                  href={`#${path}`}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </a>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{view}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-4 text-xs text-muted-foreground">
          <span>TransLab · 英语笔译自助训练</span>
          <span>评分表 {RUBRIC.version} · 未做官方校准</span>
        </div>
      </footer>
    </div>
  );
}

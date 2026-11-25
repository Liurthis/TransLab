import { BookOpenText, FileUp, Gauge, History, Layers, Plug } from "lucide-react";
import { useHashRoute } from "./lib/router";
import { MaterialsPage } from "./pages/Materials";
import { DocsPage } from "./pages/Docs";
import { PracticePage } from "./pages/Practice";
import { ProviderPage } from "./pages/Provider";
import { ResultsPage } from "./pages/Results";
import { RubricPage } from "./pages/Rubric";

const NAV = [
  { path: "/", label: "材料库", icon: Layers },
  { path: "/docs", label: "文档批改", icon: FileUp },
  { path: "/results", label: "练习记录", icon: History },
  { path: "/rubric", label: "评分规则", icon: Gauge },
  { path: "/provider", label: "模型接入", icon: Plug },
];

export default function App() {
  const route = useHashRoute();
  // "?query" 可能挂在第一段上（#/docs?saved=…）也可能挂在第二段上（#/practice/<id>?saved=…），
  // 先剥掉查询串再分路径段，否则 "#/docs?saved=x" 会被整段当成路由名而落回材料库。
  const [pathPart, query = ""] = route.split("?");
  const [section, materialId = ""] = pathPart.split("/").filter(Boolean);

  const savedAt = new URLSearchParams(query).get("saved") ?? undefined;

  const view =
    section === "practice" ? (
      // key 让切换材料或换一条记录时重新挂载，否则会留着上一篇的译文与评分。
      <PracticePage key={`${materialId}|${savedAt ?? ""}`} materialId={materialId} savedAt={savedAt} />
    ) : section === "results" ? (
      <ResultsPage />
    ) : section === "docs" ? (
      <DocsPage key={savedAt ?? ""} savedAt={savedAt} />
    ) : section === "rubric" ? (
      <RubricPage />
    ) : section === "provider" ? (
      <ProviderPage />
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
              CATTI 笔译训练
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
          <span>TransLab · 专注 CATTI 笔译的自助训练与评分</span>
        </div>
      </footer>
    </div>
  );
}

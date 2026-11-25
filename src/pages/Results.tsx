import { useMemo, useState } from "react";
import { ArrowRight, Download, History, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DIRECTION_LABELS } from "../types";
import { deleteResult, loadResults, storageState, type SavedResult } from "../lib/storage";
import { downloadRecord } from "../lib/export";
import { navigate } from "../lib/router";

/** 保存记录里可能残留已被删除的材料，列表要能指出这一点而不是显示空白行。 */
function openTarget(result: SavedResult): string {
  const saved = encodeURIComponent(result.evaluation.submitted);
  // 文档批改的记录回文档页看快照：那份材料没进材料库，练习页按 id 找不到它。
  return result.source === "docs" ? `#/docs?saved=${saved}` : `#/practice/${result.material.id}?saved=${saved}`;
}

export function ResultsPage() {
  const [results, setResults] = useState<SavedResult[]>(() => loadResults());
  const storage = useMemo(() => storageState(), []);

  const remove = (submitted: string) => {
    deleteResult(submitted);
    setResults(loadResults());
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">练习记录</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          在练习页评分后、或文档批改出分后点「保存结果」，记录就会出现在这里。点开可回看当时的译文、逐句（逐段）错误与学习清单；下载箭头导出一条 Word .docx（原文/我的译文/参考译文（若有）/得分/问题清单/建议表达与词汇）；右侧垃圾桶图标删除该条记录。
        </p>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          记录只存在这台设备的浏览器里，不上传、不跨设备同步；清除浏览器数据会一并丢失。
        </p>
        {storage !== "ok" && (
          <p className="max-w-2xl rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            本机存储当前不可用（隐私模式或浏览器设置禁用），所以看不到任何记录，也无法保存。
          </p>
        )}
      </section>

      {results.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <History className="size-4" />
            还没有保存的结果。
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate("/")}>
            去材料库开始练习
            <ArrowRight />
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((result) => {
            const { evaluation } = result;
            const filled = result.drafts.filter((text) => text.trim()).length;
            const isDoc = result.source === "docs";
            return (
              <li
                key={evaluation.submitted}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{result.material.title}</span>
                    <Badge variant="secondary">{DIRECTION_LABELS[evaluation.direction]}</Badge>
                    {isDoc && <Badge variant="outline">文档批改</Badge>}
                    {evaluation.isMock && (
                      <Badge variant="outline">演示数据</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(evaluation.submitted).toLocaleString("zh-CN")} ·{" "}
                    填写 {filled} / {result.material.sentences.length} {isDoc ? "段" : "句"} ·{" "}
                    {evaluation.isMock ? "内置示例分析" : evaluation.model} · 评分表 {evaluation.rubricVersion}
                  </p>
                </div>

                <div className="flex items-baseline gap-1 tabular-nums">
                  <span className="text-2xl font-semibold">{evaluation.score}</span>
                  <span className="text-xs text-muted-foreground">/ {evaluation.totalScore}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => navigate(openTarget(result).replace(/^#/, ""))}>
                    打开
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`下载 ${result.material.title} 的 .docx`}
                    onClick={() => downloadRecord(result)}
                  >
                    <Download />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="删除这条记录"
                    onClick={() => remove(evaluation.submitted)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// src/pages/Docs.tsx
//
// 文档批改：上传原文与译文（或一份中英对照文档），本机解析成段落、配对确认后才交给大模型。
// 三条线说清楚在界面上：
// 1) 解析只在你本机做，文件本身不上传、不保存；发出去的只有段落文字，且只发一次评分请求；
// 2) 配对结果一律摊开逐行确认，绝不静默生效——错位的配对会把之后每一段都批错，分数看着正常其实全废；
// 3) 批改以「段」为单位（一段 = 一个批改单位），分数仍由评分表确定性地算出来，模型不参与算分。

import { useMemo, useState } from "react";
import { FileText, Loader2, Save, Sparkles, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IssueList,
  ScoreCard,
  StudyPanel,
  formatScore,
} from "../components/EvaluationPanel";
import { DIRECTION_LABELS, type Direction, type Evaluation, type Material } from "../types";
import {
  paragraphLimitError,
  readDocument,
  rowsFromPairs,
  segmentOverflowError,
  sequentialPairs,
  splitByLanguage,
  type ImportedDocument,
  type PairSuggestion,
} from "../lib/docimport";
import { loadResults, saveResult, storageState } from "../lib/storage";

/** .doc/.pdf 也放进选择框：界面里能选中才能给出「另存为 .docx」这种具体下一步，
 *  而不是让用户在文件对话框里找不到自己的文件。 */
const ACCEPT = ".docx,.txt,.doc,.pdf";

interface Row {
  source: string;
  target: string;
  note: string;
}

async function postJson(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/functions/v1/app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    // 网关出错时返回的不是 JSON（504 是一段纯文本），原生报错没人看得懂。
    throw new Error(`服务没有正常返回（HTTP ${response.status}），请稍后重试。`);
  }
  return data;
}

function FileField({
  label,
  hint,
  doc,
  busy,
  onPick,
}: {
  label: string;
  hint: string;
  doc: ImportedDocument | null;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  return (
    <label className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <span className="text-sm font-medium">{label}</span>
      {/* 换文档或换模式时 doc 变回 null，靠这个 key 重挂载才能把 input 里残留的旧文件名一起清掉。 */}
      <input
        key={`${label}:${doc?.name ?? "empty"}`}
        type="file"
        accept={ACCEPT}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
        }}
        className="w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs"
      />
      <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
      {doc && (
        <span className="text-xs tabular-nums">
          读到 <strong className="font-medium">{doc.paragraphs.length}</strong> 段 · {doc.name}
          {doc.notes.length > 0 && (
            <span className="block text-muted-foreground">{doc.notes.join("；")}</span>
          )}
        </span>
      )}
    </label>
  );
}

export function DocsPage({ savedAt }: { savedAt?: string }) {
  // 从练习记录带 saved 打开：直接展示保存的段落与评分快照。文件没有留在浏览器里，不假装还能编辑。
  const restored = useMemo(() => {
    if (!savedAt) return null;
    return loadResults().find(
      (item) => item.source === "docs" && item.evaluation.submitted === savedAt,
    ) ?? null;
  }, [savedAt]);

  const [mode, setMode] = useState<"two" | "one">("two");
  const [direction, setDirection] = useState<Direction>(restored?.evaluation.direction ?? "en2zh");
  const [sourceDoc, setSourceDoc] = useState<ImportedDocument | null>(null);
  const [targetDoc, setTargetDoc] = useState<ImportedDocument | null>(null);
  const [bilingual, setBilingual] = useState<ImportedDocument | null>(null);
  const [pairs, setPairs] = useState<PairSuggestion[] | null>(null);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<boolean[]>([]);
  const [alignmentNote, setAlignmentNote] = useState("");
  const [busy, setBusy] = useState<"pair" | "grade" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(restored?.evaluation ?? null);
  const [gradedRows, setGradedRows] = useState<Row[]>(() =>
    restored
      ? restored.material.sentences.map((sentence, index) => ({
          source: sentence.source,
          target: restored.drafts[index] ?? "",
          note: "",
        }))
      : [],
  );
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const storage = useMemo(() => storageState(), []);

  // 语言判断在本机做，换方向就重算：判得出几段是「这一步不交给模型」的直接结果，必须当场看见。
  const split = useMemo(
    () => (bilingual ? splitByLanguage(bilingual.paragraphs, direction) : null),
    [bilingual, direction],
  );
  // 一份对照文档时，原文侧是拆分出来的一半段落，不是整份文档：整份当原文会把译文段也当成待批对象。
  const sourceParagraphs =
    mode === "two" ? sourceDoc?.paragraphs ?? [] : split?.sourceParagraphs ?? [];
  const targetParagraphs =
    mode === "two" ? targetDoc?.paragraphs ?? [] : split?.targetParagraphs ?? [];
  const unclassified = split?.unclassified ?? [];
  const hasSource = mode === "two" ? sourceDoc !== null : bilingual !== null;
  const sourceName = mode === "two" ? sourceDoc?.name : bilingual?.name;

  // 译文段编号 -> 用到它的行号。两行用同一段译文时，其中一行的真实译文根本没被批到，
  // 分数看着正常其实漏了一段——所以冲突必须写在行上，不能只埋在下拉框的选项里。
  const usersByTarget = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const [index, pair] of (pairs ?? []).entries()) {
      if (pair.targetIndex === null) continue;
      map.set(pair.targetIndex, [...(map.get(pair.targetIndex) ?? []), index]);
    }
    return map;
  }, [pairs]);

  const rows: Row[] = useMemo(() => {
    if (!pairs || !hasSource) return [];
    const built = rowsFromPairs(sourceParagraphs, targetParagraphs, pairs);
    return built.map((row, index) => {
      const targetIndex = pairs[index]?.targetIndex;
      const others =
        targetIndex === null || targetIndex === undefined
          ? []
          : (usersByTarget.get(targetIndex) ?? []).filter((line) => line !== index);
      const note =
        targetIndex === null
          ? "没配上，需选"
          : others.length > 0
            ? `与第 ${others.map((line) => line + 1).join("、")} 行用了同一段译文`
            : row.target
              ? ""
              : "没配上";
      return { source: row.source, target: drafts[index] ?? row.target ?? "", note };
    });
  }, [pairs, hasSource, sourceParagraphs, targetParagraphs, drafts, usersByTarget]);

  const gradedCount = rows.filter((_, index) => !skipped[index]).length;

  /** 换模式一律清干净：留着上一模式的文档与批改结果，屏幕上显示的就是上一篇的分数。 */
  const reset = () => {
    setSourceDoc(null);
    setTargetDoc(null);
    setBilingual(null);
    setPairs(null);
    setDrafts([]);
    setSkipped([]);
    setAlignmentNote("");
    setEvaluation(null);
    setGradedRows([]);
    setError(null);
  };

  const switchMode = (next: "two" | "one") => {
    if (next === mode) return;
    reset();
    setMode(next);
  };

  /** 换方向就是把两侧对调，已确认的配对与手工填的译文立刻失效，必须重新配一次。 */
  const switchDirection = (next: Direction) => {
    if (next === direction) return;
    setPairs(null);
    setDrafts([]);
    setSkipped([]);
    setAlignmentNote("");
    setEvaluation(null);
    setGradedRows([]);
    setDirection(next);
  };

  const pick = async (mode: "two" | "one", slot: "source" | "target", file: File) => {
    setMode(mode);
    setError(null);
    setEvaluation(null);
    setGradedRows([]);
    setPairs(null);
    setAlignmentNote("");
    setDrafts([]);
    setSkipped([]);
    try {
      const parsed = await readDocument(file);
      // 一份对照文档：语言由字符占比判断，这一步不交给模型；判不出的段落一律摊出来。
      if (mode === "one") setBilingual(parsed);
      else if (slot === "source") setSourceDoc(parsed);
      else setTargetDoc(parsed);
      if (parsed.paragraphs.length === 0) {
        setError(`「${parsed.name}」里没读到正文。请确认文档不是扫描件，或改用 .txt。`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取文件失败。");
    }
  };

  /** 段数相等就按顺序 1:1，不等才问模型；模型只给建议，界面上一行都不静默生效。 */
  const pair = async () => {
    if (!hasSource || targetParagraphs.length === 0) return;
    setBusy("pair");
    setError(null);
    const limit = paragraphLimitError(sourceParagraphs.length, targetParagraphs.length);
    if (limit) {
      setError(limit);
      setBusy(null);
      return;
    }
    const sequential = sequentialPairs(sourceParagraphs.length, targetParagraphs.length);
    if (sequential) {
      setPairs(sequential);
      setDrafts(sequential.map((pair) => pair.targetIndex === null ? "" : targetParagraphs[pair.targetIndex] ?? ""));
      setSkipped(sequential.map(() => false));
      setAlignmentNote(
        `${mode === "two" ? "两份文档段数相同" : "判出的原文段与译文段段数相同"}，` +
          "按出现顺序 1:1 配对。请核对每一行配得对不对。",
      );
      setBusy(null);
      return;
    }
    try {
      // 配对只看段首，前端先截断再发请求，避免长文档撑爆网关。
      const cap = Math.max(40, Math.floor(12000 / Math.max(sourceParagraphs.length, targetParagraphs.length)));
      const truncate = (text: string) => {
        const flat = text.replace(/\s+/g, " ").trim();
        return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
      };
      const data = await postJson({
        action: "align",
        direction,
        sourceParagraphs: sourceParagraphs.map(truncate),
        targetParagraphs: targetParagraphs.map(truncate),
      });
      if (data.ok !== true) {
        throw new Error(typeof data.error === "string" ? data.error : "服务没有返回配对结果");
      }
      const alignment = data.alignment as { pairs: PairSuggestion[]; notes: string };
      setPairs(alignment.pairs);
      setDrafts(alignment.pairs.map((pair) => (pair.targetIndex === null ? "" : targetParagraphs[pair.targetIndex] ?? "")));
      setSkipped(alignment.pairs.map(() => false));
      setAlignmentNote(
        `模型给的配对建议，共配上 ${alignment.pairs.filter((pair) => pair.targetIndex !== null).length} 行。` +
          (alignment.notes ? `说明：${alignment.notes}` : "") +
          "下面逐行核对，配错的行可以改选或跳过。",
      );
    } catch (caught) {
      // 配对失败不猜顺序：所有原文段落仍在表里，译文留空由用户自己选。
      setPairs(sourceParagraphs.map((_, sourceIndex) => ({ sourceIndex, targetIndex: null })));
      setDrafts(sourceParagraphs.map(() => ""));
      setSkipped(sourceParagraphs.map(() => false));
      const errorMessage = caught instanceof Error ? caught.message : "服务没有响应";
      let advice = "两侧段数不等，不能猜顺序，下面每一行的译文都留空，请自己逐行选。";
      if (errorMessage.includes("502") || errorMessage.includes("504")) {
        advice = "服务暂时不可用，可能是文档太长或网络问题。你可以稍后重试，或直接在下面手动配对。";
      } else if (errorMessage.includes("timeout")) {
        advice = "配对超时，可能是文档太长。你可以稍后重试，或直接在下面手动配对。";
      }
      setAlignmentNote(`配对失败（${errorMessage}）：${advice}`);
    } finally {
      setBusy(null);
    }
  };

  const assign = (sourceIndex: number, targetIndex: number | null) => {
    setPairs((current) =>
      (current ?? []).map((pair) => (pair.sourceIndex === sourceIndex ? { ...pair, targetIndex } : pair)),
    );
    setDrafts((current) => {
      const next = [...current];
      next[sourceIndex] = targetIndex === null ? "" : targetParagraphs[targetIndex] ?? "";
      return next;
    });
    setSkipped((current) => {
      const next = [...current];
      next[sourceIndex] = false;
      return next;
    });
  };

  const grade = async () => {
    const units = rows.filter((_, index) => !skipped[index]);
    if (units.length === 0) return;
    const overflow = segmentOverflowError(
      units.map((row) => row.source),
      direction,
    );
    if (overflow) {
      setError(overflow);
      return;
    }
    setBusy("grade");
    setError(null);
    try {
      const data = await postJson({
        materialId: `doc:${sourceName ?? "未命名"}`,
        direction,
        sourceSentences: units.map((row) => row.source),
        userTranslations: units.map((row) => row.target),
      });
      if (data.ok !== true || !data.evaluation) {
        throw new Error(typeof data.error === "string" ? data.error : "服务没有返回批改结果");
      }
      setGradedRows(units);
      setEvaluation(data.evaluation as Evaluation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批改失败，请稍后重试。");
    } finally {
      setBusy(null);
    }
  };

  const issuesByUnit = useMemo(() => {
    const map = new Map<number, Evaluation["issues"]>();
    for (const issue of evaluation?.issues ?? []) {
      map.set(issue.sentenceIndex, [...(map.get(issue.sentenceIndex) ?? []), issue]);
    }
    return map;
  }, [evaluation]);

  /** 文档不进材料库：保存的是这次批改的段落快照 + 评分，材料只存在于这条记录里。 */
  const persist = () => {
    if (!evaluation || gradedRows.length === 0) return;
    const title = (sourceName ?? restored?.material.title ?? "未命名文档").replace(
      /\.(docx?|txt|doc|pdf)$/i,
      "",
    );
    const material: Material = {
      id: `doc-${evaluation.submitted}`,
      title,
      direction,
      register: "文档批改",
      difficulty: "中级",
      sourceText: gradedRows.map((row) => row.source).join("\n\n"),
      sentences: gradedRows.map((row, index) => ({ index, source: row.source })),
      sourceNote: "文档批改保存的记录：原文只随那次批改发过一次，未存进材料库。",
      origin: "user",
      createdAt: evaluation.submitted,
    };
    const ok = saveResult({
      material,
      drafts: gradedRows.map((row) => row.target),
      evaluation,
      source: "docs",
    }).ok;
    setSaveState(ok ? "saved" : "failed");
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">文档批改</h2>
          <Badge variant="secondary">{DIRECTION_LABELS[direction]}</Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          文件在本机解析，不上传、不保存；配对结果要你逐行确认后才批改。批改以「段」为单位，分数按评分表算。
        </p>
      </header>

      {restored && (
        <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          正在查看 <strong className="font-medium text-foreground">{new Date(restored.evaluation.submitted).toLocaleString("zh-CN")}</strong>{" "}
          保存的文档批改结果。当时的文档内容没有留在浏览器里，下面是那次批改的段落快照；要批新的文档，直接在下面重新选文件即可。
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant={mode === "two" ? "default" : "outline"} size="sm" onClick={() => switchMode("two")}>
          两份文档（原文 + 我的译文）
        </Button>
        <Button variant={mode === "one" ? "default" : "outline"} size="sm" onClick={() => switchMode("one")}>
          一份中英对照文档
        </Button>
        <select
          value={direction}
          onChange={(event) => switchDirection(event.target.value as Direction)}
          className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
        >
          {(Object.keys(DIRECTION_LABELS) as Direction[]).map((item) => (
            <option key={item} value={item}>
              {DIRECTION_LABELS[item]}
            </option>
          ))}
        </select>
      </div>

      {mode === "two" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <FileField
            label="原文文档"
            hint="Word 请选 .docx（Word 97-2003 的 .doc 与 PDF 都会说明下一步怎么做）；也可以选 .txt。"
            doc={sourceDoc}
            busy={busy !== null}
            onPick={(file) => void pick("two", "source", file)}
          />
          <FileField
            label="我的译文文档"
            hint="这是你自己的作答，直接批改，不存进材料库、也不当参考译文用。"
            doc={targetDoc}
            busy={busy !== null}
            onPick={(file) => void pick("two", "target", file)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <FileField
            label="中英对照文档"
            hint="一段原文接着一段译文那样排。分段按字符占比判断每段是中文还是英文，这一步不交给大模型。"
            doc={bilingual}
            busy={busy !== null}
            onPick={(file) => void pick("one", "source", file)}
          />
          {bilingual && (
            <p className="text-xs leading-relaxed text-muted-foreground tabular-nums">
              共 <strong className="font-medium">{bilingual.paragraphs.length}</strong> 段 →
              判为原文 <strong className="font-medium">{sourceParagraphs.length}</strong> 段 ·
              判为译文 <strong className="font-medium">{targetParagraphs.length}</strong> 段 ·
              判不出来 <strong className="font-medium">{unclassified.length}</strong> 段
              {unclassified.length > 0 &&
                "（判不出来的段落不会丢，逐条列在下面）"}
            </p>
          )}
          {split && split.unclassified.length > 0 && (
            <ul className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-4 text-xs">
              {split.unclassified.map((item) => (
                <li key={item.index} className="leading-relaxed">
                  <span className="font-medium tabular-nums">
                    文档第 {item.index + 1} 段 ·{" "}
                    {item.reason === "mixed" ? "中英文混在同一段，规则不猜段界" : "文字太少，判不出语言"}
                  </span>
                  <span className="block text-muted-foreground">{item.text}</span>
                </li>
              ))}
              <li className="leading-relaxed text-muted-foreground">
                这些段落既不在原文侧也不在译文侧，因此不参与批改。要让它们被批到，请在文档里把中英文分成两段后重新上传。
              </li>
            </ul>
          )}
        </div>
      )}

      {hasSource && targetParagraphs.length > 0 && !pairs && (
        <Button size="sm" disabled={busy !== null} onClick={() => void pair()}>
          {busy === "pair" ? <Loader2 className="animate-spin" /> : <Undo2 />}
          {busy === "pair" ? "配对中……" : "配对段落"}
        </Button>
      )}

      {pairs && hasSource && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight">配对确认</h3>
            <span className="text-xs text-muted-foreground">{alignmentNote}</span>
          </div>

          <div className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const pair = pairs[index];
              return (
                <article
                  key={index}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 size-6 shrink-0 rounded-full bg-muted text-center text-xs leading-6 tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <p className="font-serif text-sm leading-relaxed">{row.source}</p>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{row.note}</span>
                  </div>

                  <textarea
                    value={row.target}
                    rows={3}
                    disabled={skipped[index]}
                    onChange={(event) =>
                      setDrafts((current) => {
                        const next = [...current];
                        next[index] = event.target.value;
                        return next;
                      })
                    }
                    placeholder="这段没有配上译文；也可以自己填上你的译文"
                    className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:bg-muted/40"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={pair?.targetIndex === null ? "" : String(pair?.targetIndex ?? "")}
                      disabled={skipped[index]}
                      onChange={(event) =>
                        assign(index, event.target.value === "" ? null : Number(event.target.value))
                      }
                      className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
                    >
                      <option value="">（不配，这段按漏译处理）</option>
                      {targetParagraphs.map((text, targetIndex) => {
                        const others = (usersByTarget.get(targetIndex) ?? []).filter(
                          (line) => line !== index,
                        );
                        return (
                          <option key={targetIndex} value={targetIndex}>
                            译文第 {targetIndex + 1} 段
                            {others.length > 0
                              ? `（已用在第 ${others.map((line) => line + 1).join("、")} 行）`
                              : ""}
                            ：{text.slice(0, 40)}
                          </option>
                        );
                      })}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSkipped((current) => {
                          const next = [...current];
                          next[index] = !next[index];
                          return next;
                        })
                      }
                    >
                      {skipped[index] ? "恢复批改这段" : "这段不批（如小标题）"}
                    </Button>
                    {skipped[index] && (
                      <span className="text-xs text-muted-foreground">不计入分数</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
            <Button
              size="sm"
              disabled={busy !== null || gradedCount === 0}
              onClick={() => void grade()}
            >
              {busy === "grade" ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {busy === "grade" ? "批改中……" : "确认配对，开始批改"}
            </Button>
            <span>
              共 {rows.length} 段 · 批改 {gradedCount} 段 · 跳过 {rows.length - gradedCount} 段
            </span>
            <span>批改完成后点结果下方的「保存结果」，可存进练习记录稍后回看。</span>
          </div>
        </section>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">错误：{error}</p>}

      {evaluation && (
        <>
          <ScoreCard evaluation={evaluation} />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {storage === "ok" ? (
              <>
                <Button size="sm" variant="outline" onClick={persist} disabled={saveState === "saved"}>
                  <Save />
                  {saveState === "saved" ? "已保存" : "保存结果"}
                </Button>
                {saveState === "saved" && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    已存进「练习记录」，随时可打开回看。
                  </span>
                )}
                {saveState === "failed" && (
                  <span className="text-amber-600 dark:text-amber-400">
                    保存失败：本机存储不可用或已满，这次批改没有被存下。
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">
                本机存储当前不可用（隐私模式或浏览器设置禁用），这次批改无法保存。
              </span>
            )}
          </div>
          <StudyPanel evaluation={evaluation} />

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold tracking-tight">逐段批改</h3>
            <span className="text-xs text-muted-foreground">
              下面每一行是一段；「第 N 项」与此对应，行号按批改的那 {gradedRows.length} 段计。
            </span>
            {gradedRows.map((row, index) => {
              const issues = issuesByUnit.get(index) ?? [];
              const result = evaluation.sentenceScores[index];
              return (
                <article key={index} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 size-6 shrink-0 rounded-full bg-muted text-center text-xs leading-6 tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="flex flex-col gap-1">
                      <p className="font-serif text-sm leading-relaxed">{row.source}</p>
                      <p className="font-serif text-sm leading-relaxed text-muted-foreground">{row.target}</p>
                    </div>
                    {result && (
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatScore(result.score)} / {result.max}
                      </span>
                    )}
                  </div>
                  <IssueList issues={issues} />
                  {issues.length === 0 && (
                    <p className="text-xs text-muted-foreground">这段没有定位到问题。</p>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

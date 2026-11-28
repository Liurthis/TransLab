import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FlaskConical, Loader2, Play, Save, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MockBanner } from "../components/MockBanner";
import {
  IssueList,
  SEVERITY_STYLE,
  ScoreCard,
  StudyPanel,
  formatScore,
  worstSeverity,
} from "../components/EvaluationPanel";
import { DIRECTION_LABELS, type Evaluation, type Issue } from "../types";
import { DEMO_EXPRESSIONS, DEMO_ISSUES, DEMO_MATERIAL_ID, DEMO_VOCABULARY } from "../data/demo-issues";
import { DEMO_SUBMISSION } from "../data/materials";
import { RUBRIC } from "../data/rubric";
import { buildEvaluation } from "../lib/scoring";
import {
  deleteDraft,
  findMaterial,
  loadDraft,
  loadResults,
  providerPayload,
  saveDraft,
  saveResult,
  storageState,
} from "../lib/storage";
import { navigate } from "../lib/router";

/** 保存的记录可能来自句数不同的旧版本材料，按当前句数补齐空行，不能让 textarea 拿到 undefined。 */
function alignDrafts(source: string[], rows: number): string[] {
  return Array.from({ length: rows }, (_, i) => source[i] ?? "");
}

type DraftNotice = { kind: "restored" | "saved" | "failed"; at: string };

const DRAFT_SAVE_DELAY_MS = 500;

export function PracticePage({ materialId, savedAt }: { materialId: string; savedAt?: string }) {
  // 从练习记录页带 saved=<submitted> 进来时，恢复当时的译文与评分，而不是重新评一次。
  const restored = useMemo(() => {
    if (!savedAt) return null;
    return (
      loadResults().find(
        (item) => item.evaluation.submitted === savedAt && item.material.id === materialId,
      ) ?? null
    );
  }, [savedAt, materialId]);

  // 记录里自带材料快照：自建材料被删掉之后，这条记录仍要能打开，不能变成死链。
  const material = useMemo(
    () => restored?.material ?? findMaterial(materialId),
    [materialId, restored],
  );
  const rows = material?.sentences.length ?? 0;

  // 自动草稿只在「正常打开练习」时恢复；带 savedAt 看记录时以记录里的译文为准。
  const draftEntry = useMemo(
    () => (savedAt ? null : loadDraft(materialId)),
    [materialId, savedAt],
  );
  const hasDraftContent = draftEntry?.drafts.some((text) => text.trim()) ?? false;

  const [drafts, setDrafts] = useState<string[]>(() =>
    alignDrafts(restored?.drafts ?? draftEntry?.drafts ?? [], rows),
  );
  const [evaluation, setEvaluation] = useState<Evaluation | null>(restored?.evaluation ?? null);
  // 评分对应的是提交那一刻的译文：之后随手改几处再点保存，存下去的必须是评过的那一版，
  // 否则记录里的分数、错误引用和屏幕上的文字对不上。
  const [gradedDrafts, setGradedDrafts] = useState<string[] | null>(() =>
    restored ? alignDrafts(restored.drafts, rows) : null,
  );
  const [viewingSnapshot, setViewingSnapshot] = useState(Boolean(savedAt && restored));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const [draftNotice, setDraftNotice] = useState<DraftNotice | null>(() =>
    hasDraftContent && draftEntry ? { kind: "restored", at: draftEntry.updatedAt } : null,
  );
  const storage = useMemo(() => storageState(), []);

  // 译文快照 + 待写入定时器：编辑后半秒落盘，页面被关掉/切走时把没来得及写的补上。
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const saveTimer = useRef<number | null>(null);

  const scheduleDraftSave = () => {
    if (storage !== "ok" || !materialId) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const result = saveDraft(materialId, draftsRef.current);
      setDraftNotice(result.ok ? { kind: "saved", at: new Date().toISOString() } : { kind: "failed", at: new Date().toISOString() });
    }, DRAFT_SAVE_DELAY_MS);
  };

  // 卸载（切材料/切页面）时仍有待发写入就立刻落盘；关标签页靠 beforeunload 兜底。
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        saveDraft(materialId, draftsRef.current);
      }
    };
  }, [materialId]);

  useEffect(() => {
    const onLeave = () => {
      if (saveTimer.current !== null) {
        saveDraft(materialId, draftsRef.current);
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [materialId]);

  const issuesBySentence = useMemo(() => {
    const map = new Map<number, Issue[]>();
    for (const issue of evaluation?.issues ?? []) {
      map.set(issue.sentenceIndex, [...(map.get(issue.sentenceIndex) ?? []), issue]);
    }
    return map;
  }, [evaluation]);

  const filledCount = drafts.filter((text) => text.trim()).length;
  const editedAfterGrade =
    !!evaluation &&
    !!gradedDrafts &&
    drafts.some((text, index) => text !== (gradedDrafts[index] ?? ""));

  const setDraft = (index: number, value: string) => {
    setDrafts((current) => current.map((item, i) => (i === index ? value : item)));
    // 改过文本后，屏幕上那句「已保存」不再对应当前内容，撤掉它，让保存按钮重新可用。
    setSaveState("idle");
    scheduleDraftSave();
  };

  const clearDraft = () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    deleteDraft(materialId);
    setDrafts(alignDrafts([], rows));
    setDraftNotice(null);
  };

  // 示例数据是照内置材料写死的，套在别的材料上就是伪造评估，因此只在该材料上开放。
  const demoAvailable =
    !!material &&
    material.id === DEMO_MATERIAL_ID &&
    material.direction === "en2zh" &&
    material.sentences.length === DEMO_SUBMISSION.length;

  const loadDemo = () => {
    if (!material) return;
    setDrafts(alignDrafts(DEMO_SUBMISSION, material.sentences.length));
    setEvaluation(null);
    setGradedDrafts(null);
    setSaveState("idle");
    setError(null);
    scheduleDraftSave();
  };

  const runDemoEvaluation = () => {
    if (!material) return;
    setEvaluation(
      buildEvaluation(
        material,
        RUBRIC,
        DEMO_ISSUES,
        {
          isMock: true,
          provider: "fixture",
          model: "内置示例分析",
          submitted: new Date().toISOString(),
        },
        { expressions: DEMO_EXPRESSIONS, vocabulary: DEMO_VOCABULARY },
      ),
    );
    setGradedDrafts(drafts);
    setViewingSnapshot(false);
    setSaveState("idle");
    setError(null);
  };

  const submitEvaluation = async () => {
    if (!material) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/functions/v1/app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: material.id,
          direction: material.direction,
          sourceSentences: material.sentences.map((s) => s.source),
          userTranslations: drafts,
          ...providerPayload(),
        }),
      });
      // 网关出错时返回的不是 JSON，直接 response.json() 会抛出没人看得懂的原生报错。
      const text = await response.text();
      let data: { ok?: boolean; error?: string; detail?: string; evaluation?: Evaluation };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`服务返回了无法解析的内容（HTTP ${response.status}），请稍后重试。`);
      }
      if (!data.ok || !data.evaluation) {
        // 带上 detail：自己接模型时最常见的失败是地址连不通，只看错误码没法知道该改哪里。
        throw new Error(
          `${data.error ?? "服务没有返回评估结果"}${data.detail ? ` · ${data.detail}` : ""}`,
        );
      }
      setEvaluation(data.evaluation);
      setGradedDrafts(drafts);
      setViewingSnapshot(false);
      setSaveState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const persist = () => {
    if (!material || !evaluation) return;
    // 存评过的那一版：用户可能从记录里打开、改了两处却没重新提交，不能把新文字配上旧分数。
    const snapshot = gradedDrafts ?? drafts;
    setSaveState(saveResult({ material, drafts: snapshot, evaluation }).ok ? "saved" : "failed");
  };

  if (!material) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          未找到该材料。它可能已经在本机被删除。
        </p>
        <Button variant="outline" size="sm" className="w-fit" onClick={() => navigate("/")}>
          <ArrowLeft />
          返回材料库
        </Button>
      </div>
    );
  }

  const scoreBySentence = new Map(
    (evaluation?.sentenceScores ?? []).map((item) => [item.index, item]),
  );
  const referenceAvailable = material.sentences.some((s) => Boolean(s.reference));
  const translationHint =
    material.direction === "zh2en" ? "在此写出这句的英文译文……" : "在此写出这句的中文译文……";
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            返回材料库
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{material.title}</h2>
            <Badge variant="secondary">{DIRECTION_LABELS[material.direction]}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {material.register} · {material.difficulty} · 共{" "}
            {material.sentences.length} 句 · 满分 {RUBRIC.totalScore}
          </p>
        </div>

        {demoAvailable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadDemo}>
              <FlaskConical />
              载入示例译文
            </Button>
            <Button size="sm" onClick={runDemoEvaluation} disabled={filledCount === 0}>
              <Sparkles />
              查看示例评估
            </Button>
          </div>
        )}
      </header>

      {viewingSnapshot && (
        <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          正在查看 <strong className="font-medium text-foreground">{new Date(savedAt ?? "").toLocaleString("zh-CN")}</strong>{" "}
          保存的结果。可以直接改译文，改完重新「提交评分」；这条记录本身不会被覆盖。
        </p>
      )}

      {savedAt && !restored && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          没有找到这条练习记录，可能已在本机被删除。下面是这篇材料的练习页。
        </p>
      )}

      {draftNotice?.kind === "restored" && (
        <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          已恢复 <strong className="font-medium text-foreground">{new Date(draftNotice.at).toLocaleString("zh-CN")}</strong>{" "}
          自动保存、还没有提交评分的译文，可以接着写。
          <button
            type="button"
            onClick={clearDraft}
            className="ml-1 underline hover:text-foreground"
          >
            清空重来
          </button>
        </p>
      )}

      <MockBanner mock={evaluation?.isMock === true} />

      {!evaluation && (
        <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {material.direction === "zh2en" ? "逐句写出英文译文" : "逐句写出中文译文"}。
          点击<strong className="font-medium">「提交评分」</strong>会调用后端大模型对你自己的译文进行真实评分。
          {demoAvailable
            ? "点击「查看示例评估」会展示预先编写好的示例分析。"
            : "这篇材料没有配套的内置示例分析，写好译文后用「提交评分」做真实评分。"}
        </p>
      )}

      {evaluation && (
        <>
          <ScoreCard
            evaluation={evaluation}
            noReference={
              !referenceAvailable && "本篇材料没有人工审定的参考译文，因此不提供逐句对照。"
            }
          />
          <StudyPanel evaluation={evaluation} />
        </>
      )}

      <div id="score-panel" className="flex flex-col gap-4">
        {material.sentences.map((sentence) => {
          const issues = issuesBySentence.get(sentence.index) ?? [];
          const worst = worstSeverity(issues);
          const sentenceResult = scoreBySentence.get(sentence.index);

          return (
            <article
              key={sentence.index}
              className="overflow-hidden rounded-lg border border-border bg-card"
            >
              <div className="flex">
                <div
                  className={`w-1 shrink-0 ${worst ? SEVERITY_STYLE[worst].bar : "bg-transparent"}`}
                  aria-hidden
                />

                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 size-6 shrink-0 rounded-full bg-muted text-center text-xs leading-6 tabular-nums text-muted-foreground">
                      {sentence.index + 1}
                    </span>
                    <p
                      id={sentence.index === 0 ? "source-text" : undefined}
                      className="font-serif text-base leading-relaxed"
                    >
                      {sentence.source}
                    </p>
                    {sentenceResult && (
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatScore(sentenceResult.score)} / {sentenceResult.max}
                      </span>
                    )}
                  </div>

                  <textarea
                    id={sentence.index === 0 ? "translation-input" : undefined}
                    value={drafts[sentence.index]}
                    onChange={(event) => setDraft(sentence.index, event.target.value)}
                    placeholder={translationHint}
                    rows={3}
                    className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  />

                  <IssueList issues={issues} />

                  {evaluation && sentence.reference && (
                    <details className="group text-xs">
                      <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">
                        参考译文
                      </summary>
                      <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 leading-relaxed text-foreground">
                        {sentence.reference}
                      </p>
                    </details>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
        <Button
          variant="outline"
          size="sm"
          disabled={submitting || filledCount === 0}
          onClick={submitEvaluation}
        >
          {submitting ? <Loader2 className="animate-spin" /> : <Play />}
          {submitting ? "评分中……" : "提交评分"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!evaluation || storage !== "ok"}
          onClick={persist}
        >
          <Save />
          保存结果
        </Button>
        <span>
          已填写 {filledCount} / {material.sentences.length} 句
        </span>
        {storage === "ok" ? (
          <span
            className={
              draftNotice?.kind === "failed" ? "text-red-600 dark:text-red-400" : undefined
            }
          >
            {draftNotice?.kind === "failed"
              ? "草稿自动保存失败：本机存储写入被拒绝，译文可能没存住。"
              : draftNotice?.kind === "saved"
                ? `草稿已自动保存 ${new Date(draftNotice.at).toLocaleTimeString("zh-CN")}`
                : "未提交的译文会自动存在这台设备，关掉页面也能接着写"}
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">
            本机存储不可用，关闭页面后这些译文会丢失。
          </span>
        )}
        {evaluation && storage === "ok" && saveState === "saved" && (
          <span className="text-emerald-600 dark:text-emerald-400">
            已保存到本机浏览器 · <a href="#/results" className="underline">查看练习记录</a>
          </span>
        )}
        {evaluation && storage === "ok" && saveState === "failed" && (
          <span className="text-red-600 dark:text-red-400">保存失败：本机存储空间已满或写入被拒绝。</span>
        )}
        {evaluation && storage !== "ok" && (
          <span>本机存储不可用（隐私模式或被禁用），无法保存结果。</span>
        )}
        {editedAfterGrade && (
          <span className="text-amber-700 dark:text-amber-400">
            译文在评分后改过：上面的分数对应上次提交的版本，重新「提交评分」才会更新。
          </span>
        )}
        {error && (
          <span className="text-red-600 dark:text-red-400">
            错误：{error}
          </span>
        )}
      </div>
    </div>
  );
}

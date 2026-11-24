import { useMemo, useState } from "react";
import { ArrowLeft, FlaskConical, Loader2, Play, Save, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MockBanner } from "../components/MockBanner";
import { Separator } from "@/components/ui/separator";
import {
  DIRECTION_LABELS,
  ISSUE_LABELS,
  SEVERITY_LABELS,
  type Evaluation,
  type Issue,
  type LearningItem,
  type Severity,
} from "../types";
import { DEMO_EXPRESSIONS, DEMO_ISSUES, DEMO_MATERIAL_ID, DEMO_VOCABULARY } from "../data/demo-issues";
import { DEMO_SUBMISSION } from "../data/materials";
import { RUBRIC } from "../data/rubric";
import { buildEvaluation } from "../lib/scoring";
import { findMaterial, loadResults, saveResult, storageState } from "../lib/storage";
import { navigate } from "../lib/router";

const SEVERITY_STYLE: Record<Severity, { bar: string; badge: string }> = {
  light: { bar: "bg-sky-500", badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  moderate: { bar: "bg-amber-500", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  severe: { bar: "bg-red-500", badge: "bg-red-500/15 text-red-700 dark:text-red-300" },
};

const SEVERITY_RANK: Record<Severity, number> = { light: 1, moderate: 2, severe: 3 };

function worstSeverity(issues: Issue[]): Severity | null {
  return issues.reduce<Severity | null>(
    (worst, issue) =>
      !worst || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[worst]
        ? issue.severity
        : worst,
    null,
  );
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 保存的记录可能来自句数不同的旧版本材料，按当前句数补齐空行，不能让 textarea 拿到 undefined。 */
function alignDrafts(source: string[], rows: number): string[] {
  return Array.from({ length: rows }, (_, i) => source[i] ?? "");
}

function StudyColumn({ title, items }: { title: string; items: LearningItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((entry, i) => (
          <li key={`${title}-${i}`} className="rounded-md border border-border px-3 py-2">
            <p className="font-serif text-sm leading-relaxed">{entry.item}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{entry.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PracticePage({ materialId, savedAt }: { materialId: string; savedAt?: string }) {
  const material = useMemo(() => findMaterial(materialId), [materialId]);
  const rows = material?.sentences.length ?? 0;

  // 从练习记录页带 saved=<submitted> 进来时，恢复当时的译文与评分，而不是重新评一次。
  const restored = useMemo(() => {
    if (!savedAt) return null;
    return (
      loadResults().find(
        (item) => item.evaluation.submitted === savedAt && item.material.id === materialId,
      ) ?? null
    );
  }, [savedAt, materialId]);

  const [drafts, setDrafts] = useState<string[]>(() =>
    alignDrafts(restored?.drafts ?? [], rows),
  );
  const [evaluation, setEvaluation] = useState<Evaluation | null>(restored?.evaluation ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const storage = useMemo(() => storageState(), []);

  const issuesBySentence = useMemo(() => {
    const map = new Map<number, Issue[]>();
    for (const issue of evaluation?.issues ?? []) {
      map.set(issue.sentenceIndex, [...(map.get(issue.sentenceIndex) ?? []), issue]);
    }
    return map;
  }, [evaluation]);

  const filledCount = drafts.filter((text) => text.trim()).length;

  const setDraft = (index: number, value: string) =>
    setDrafts((current) => current.map((item, i) => (i === index ? value : item)));

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
    setSaveState("idle");
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
    setSaveState("idle");
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
        }),
      });
      // 网关出错时返回的不是 JSON，直接 response.json() 会抛出没人看得懂的原生报错。
      const text = await response.text();
      let data: { ok?: boolean; error?: string; evaluation?: Evaluation };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`服务返回了无法解析的内容（HTTP ${response.status}），请稍后重试。`);
      }
      if (!data.ok || !data.evaluation) {
        throw new Error(data.error ?? "服务没有返回评估结果");
      }
      setEvaluation(data.evaluation);
      setSaveState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const persist = () => {
    if (!material || !evaluation) return;
    setSaveState(saveResult({ material, drafts, evaluation }).ok ? "saved" : "failed");
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
  const hasStudy =
    !!evaluation && (evaluation.expressions.length > 0 || evaluation.vocabulary.length > 0);

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

      {savedAt && (
        <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          正在查看 <strong className="font-medium text-foreground">{new Date(savedAt).toLocaleString("zh-CN")}</strong>{" "}
          保存的结果。可以直接改译文，改完重新「提交评分」；这条记录本身不会被覆盖。
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
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums tracking-tight">
                {formatScore(evaluation.score)}
              </span>
              <span className="text-sm text-muted-foreground">
                / {evaluation.totalScore}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {evaluation.summary}
            </p>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${(evaluation.score / evaluation.totalScore) * 100}%`,
              }}
            />
          </div>

          <Separator />

          <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt>评分表版本</dt>
              <dd className="font-medium text-foreground tabular-nums">
                {evaluation.rubricVersion}
              </dd>
            </div>
            <div>
              <dt>分析来源</dt>
              <dd className="font-medium text-foreground">{evaluation.model}</dd>
            </div>
            <div>
              <dt>provider</dt>
              <dd className="font-medium text-foreground">{evaluation.provider}</dd>
            </div>
            <div>
              <dt>是否真实模型</dt>
              <dd className={evaluation.isMock ? "font-medium text-amber-600" : "font-medium"}>
                {evaluation.isMock ? "否（演示数据）" : "是"}
              </dd>
            </div>
          </dl>

          {!referenceAvailable && (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              本篇材料没有人工审定的参考译文，因此不提供逐句对照。
              评分依据是模型定位到的具体错误，不是与某个标准答案比对；
              系统也不会为了让页面好看而临时生成一份「参考译文」。
            </p>
          )}
        </section>
      )}

      {evaluation && (
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight">建议学习</h3>
            <span className="text-xs text-muted-foreground">
              模型给出、未经人工审定 · 学习条目一律为英文
            </span>
          </div>
          {hasStudy ? (
            <div className="grid gap-5 md:grid-cols-2">
              <StudyColumn title="值得学习的表达" items={evaluation.expressions} />
              <StudyColumn title="值得积累的词汇" items={evaluation.vocabulary} />
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              这次模型没有列出值得学习的表达与词汇。
            </p>
          )}
        </section>
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

                  {issues.length > 0 && (
                    <ul className="flex flex-col gap-3">
                      {issues.map((issue) => (
                        <li key={`${issue.category}-${issue.severity}-${issue.quote}`} className="flex flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLE[issue.severity].badge}`}
                            >
                              {ISSUE_LABELS[issue.category]} · {SEVERITY_LABELS[issue.severity]}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              "{issue.quote}"
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed">{issue.problem}</p>
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            <span className="font-medium text-foreground">建议：</span>
                            {issue.suggestion}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}

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
        {error && (
          <span className="text-red-600 dark:text-red-400">
            错误：{error}
          </span>
        )}
      </div>
    </div>
  );
}

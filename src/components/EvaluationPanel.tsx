// src/components/EvaluationPanel.tsx
//
// 评分结果的展示件：练习页与文档批改页共用同一套渲染，
// 避免同一个分数在两个页面上显示成两种样子。分数一律来自 scoring.ts，这里只展示不算分。

import type { ReactNode } from "react";
import {
  ISSUE_LABELS,
  SEVERITY_LABELS,
  type Evaluation,
  type Issue,
  type LearningItem,
  type Severity,
} from "../types";
import { Separator } from "@/components/ui/separator";

export const SEVERITY_STYLE: Record<Severity, { bar: string; badge: string }> = {
  light: { bar: "bg-sky-500", badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  moderate: { bar: "bg-amber-500", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  severe: { bar: "bg-red-500", badge: "bg-red-500/15 text-red-700 dark:text-red-300" },
};

const SEVERITY_RANK: Record<Severity, number> = { light: 1, moderate: 2, severe: 3 };

export function worstSeverity(issues: Issue[]): Severity | null {
  return issues.reduce<Severity | null>(
    (worst, issue) =>
      !worst || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[worst] ? issue.severity : worst,
    null,
  );
}

export function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3">
      {issues.map((issue, position) => (
        <li
          key={`${issue.sentenceIndex}-${issue.category}-${issue.severity}-${position}`}
          className="flex flex-col gap-1.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLE[issue.severity].badge}`}
            >
              {ISSUE_LABELS[issue.category]} · {SEVERITY_LABELS[issue.severity]}
            </span>
            {issue.quote && (
              <span className="text-xs text-muted-foreground">
                {issue.category === "omission" ? "原文漏掉：" : "问题片段："}“{issue.quote}”
              </span>
            )}
          </div>
          {issue.problem && <p className="text-sm leading-relaxed">{issue.problem}</p>}
          {issue.suggestion && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">建议：</span>
              {issue.suggestion}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
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

export function StudyPanel({ evaluation }: { evaluation: Evaluation }) {
  const hasStudy = evaluation.expressions.length > 0 || evaluation.vocabulary.length > 0;
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">建议学习</h3>
        <span className="text-xs text-muted-foreground">
          {evaluation.isMock ? "内置示例" : "模型给出"} · 学习条目一律为英文
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
  );
}

/** 分数卡：总分、点评、评分口径，以及"这篇材料到底有什么"的如实说明。 */
export function ScoreCard({
  evaluation,
  noReference,
}: {
  evaluation: Evaluation;
  noReference?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums tracking-tight">
            {formatScore(evaluation.score)}
          </span>
          <span className="text-sm text-muted-foreground">/ {evaluation.totalScore}</span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{evaluation.summary}</p>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(evaluation.score / evaluation.totalScore) * 100}%` }}
        />
      </div>

      <Separator />

      <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt>评分表版本</dt>
          <dd className="font-medium text-foreground tabular-nums">{evaluation.rubricVersion}</dd>
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

      {noReference && (
        <div className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {noReference}
        </div>
      )}
    </section>
  );
}

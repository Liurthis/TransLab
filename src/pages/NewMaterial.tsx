import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DIRECTION_LABELS,
  type Direction,
  type Material,
} from "../types";
import { MAX_SEGMENTS, segmentText, sourceLength } from "../lib/segment";
import { saveUserMaterial } from "../lib/storage";

const DIFFICULTIES: Material["difficulty"][] = ["入门", "中级", "高级"];

/** 校验只看非空白字符，标点与空格允许被界面规整掉。 */
function comparable(text: string): string {
  return text.replace(/\s/g, "");
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function NewMaterialPanel({ onSaved }: { onSaved: (material: Material) => void }) {
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState<Direction>("en2zh");
  const [register, setRegister] = useState("");
  const [difficulty, setDifficulty] = useState<Material["difficulty"]>("中级");
  const [sourceText, setSourceText] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [segments, setSegments] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const autoSegment = (text: string, dir: Direction) => {
    setSegments(segmentText(text, dir));
  };

  const onSourceChange = (value: string) => {
    setSourceText(value);
    autoSegment(value, direction);
  };

  const onDirectionChange = (dir: Direction) => {
    setDirection(dir);
    // 方向决定切句规则，换方向必须按新规则重切。
    if (sourceText.trim()) autoSegment(sourceText, dir);
  };

  const mergeUp = (index: number) => {
    if (index === 0) return;
    setSegments((current) => {
      const next = [...current];
      next[index - 1] = `${next[index - 1]} ${next[index]}`.replace(/\s+/g, " ").trim();
      next.splice(index, 1);
      return next;
    });
  };

  /** 在该句 textarea 的光标处拆成两句；不猜，由你指定断点。 */
  const splitAtCaret = (index: number) => {
    const el = rowRefs.current[index];
    const caret = el?.selectionStart ?? 0;
    setSegments((current) => {
      const text = current[index] ?? "";
      const head = text.slice(0, caret).trim();
      const tail = text.slice(caret).trim();
      if (!head || !tail) return current;
      const next = [...current];
      next.splice(index, 1, head, tail);
      return next;
    });
  };

  const deleteRow = (index: number) =>
    setSegments((current) => current.filter((_, i) => i !== index));

  const setRow = (index: number, value: string) =>
    setSegments((current) => current.map((item, i) => (i === index ? value : item)));

  const referenceLines = useMemo(
    () => referenceText.split(/\n{2,}|\n/).map((line) => line.trim()).filter(Boolean),
    [referenceText],
  );

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!title.trim()) list.push("请填写材料标题。");
    if (!sourceText.trim()) list.push("请粘贴整篇原文。");
    if (segments.length === 0) list.push("还没有可练习的句段。");
    if (segments.length > MAX_SEGMENTS) {
      list.push(`句段超过 ${MAX_SEGMENTS} 段，请拆成多篇材料。`);
    }
    if (segments.some((segment) => !segment.trim())) list.push("有空句段，请填写或删除。");

    const joined = comparable(segments.join(" "));
    const original = comparable(sourceText);
    // 手工编辑后允许空格差异，但不允许整段消失或被改写掉：字符对不上就是出事了。
    if (segments.length && joined.length !== original.length) {
      list.push(
        `断句后的文字与原文对不上（原文 ${original.length} 字 / 现在 ${joined.length} 字），可能有句段被删掉或重复。`,
      );
    }
    if (referenceLines.length && referenceLines.length !== segments.length) {
      list.push(
        `参考译文有 ${referenceLines.length} 句，与 ${segments.length} 个句段对不上；没有参考译文就留空。`,
      );
    }
    return list;
  }, [title, sourceText, segments, referenceLines]);

  const save = () => {
    setSaveError(null);
    if (problems.length) return;

    const material: Material = {
      id: newId(),
      title: title.trim(),
      direction,
      register: register.trim() || "未标注文体",
      difficulty,
      sourceText,
      origin: "user",
      createdAt: new Date().toISOString(),
      sentences: segments.map((source, index) => ({
        index,
        source,
        ...(referenceLines[index] ? { reference: referenceLines[index] } : {}),
      })),
    };

    const result = saveUserMaterial(material);
    if (!result.ok) {
      setSaveError(
        result.state === "disabled"
          ? "本机存储不可用（隐私模式或嵌入式浏览器），材料没法保存。"
          : "本机存储空间已满或写入失败，材料没有保存成功。",
      );
      return;
    }
    onSaved(material);
  };

  const words = useMemo(
    () => (sourceText.trim() ? sourceLength(sourceText, direction) : 0),
    [sourceText, direction],
  );

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h3 className="text-sm font-medium">添加自己的练习材料</h3>
        <span className="text-xs text-muted-foreground">
          粘贴整篇原文，自动断句；存到本机浏览器
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium">材料标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：城市绿地与公共健康"
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium">文体 / 语域</span>
          <input
            value={register}
            onChange={(event) => setRegister(event.target.value)}
            placeholder="例如：外刊科普评论"
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">翻译方向</span>
          {(["en2zh", "zh2en"] as Direction[]).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => onDirectionChange(dir)}
              aria-pressed={direction === dir}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                direction === dir
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {DIRECTION_LABELS[dir]}
              <span className="ml-1 text-muted-foreground">
                {dir === "en2zh" ? "英文→中文" : "中文→英文"}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">难度</span>
          {DIFFICULTIES.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setDifficulty(level)}
              aria-pressed={difficulty === level}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                difficulty === level
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5 text-xs">
        <span className="flex items-center justify-between gap-2 font-medium">
          <span>{direction === "en2zh" ? "英文原文（整篇）" : "中文原文（整篇）"}</span>
          <span className="text-muted-foreground">
            {words > 0 ? `${words} ${direction === "en2zh" ? "词" : "字"}` : ""}
          </span>
        </span>
        <textarea
          value={sourceText}
          onChange={(event) => onSourceChange(event.target.value)}
          rows={8}
          placeholder={
            direction === "en2zh"
              ? "把要练习的英文原文粘贴在这里……"
              : "把要练习的中文原文粘贴在这里……"
          }
          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => autoSegment(sourceText, direction)} disabled={!sourceText.trim()}>
          <Wand2 />
          重新自动断句
        </Button>
        <span className="text-xs text-muted-foreground">
          当前 {segments.length} 个句段 · 上限 {MAX_SEGMENTS}
        </span>
      </div>

      {segments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {segments.map((segment, index) => (
            <li key={`${index}-${segment.slice(0, 12)}`} className="flex items-start gap-2">
              <span className="mt-2 size-6 shrink-0 rounded-full bg-muted text-center text-xs leading-6 tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <textarea
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                value={segment}
                onChange={(event) => setRow(index, event.target.value)}
                rows={2}
                aria-label={`第 ${index + 1} 个句段`}
                className="min-w-0 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <div className="flex shrink-0 flex-col gap-1">
                <Button size="sm" variant="outline" onClick={() => mergeUp(index)} disabled={index === 0}>
                  合并到上一句
                </Button>
                <Button size="sm" variant="outline" onClick={() => splitAtCaret(index)}>
                  在光标处拆句
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteRow(index)}>
                  <Trash2 />
                  删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <label className="flex flex-col gap-1.5 text-xs">
        <span className="font-medium">
          参考译文（可选，每句一行或空行分隔；多数情况留空）
        </span>
        <textarea
          value={referenceText}
          onChange={(event) => setReferenceText(event.target.value)}
          rows={4}
          placeholder="没有人工审定的参考译文就留空。留空时练习页不展示参考译文，只给评分与逐句问题分析。"
          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </label>

      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {problem}
            </li>
          ))}
        </ul>
      )}

      {saveError && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs leading-relaxed text-red-700 dark:text-red-400">
          {saveError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={problems.length > 0}>
          {problems.length === 0 ? <Check /> : <Loader2 className="animate-spin" />}
          保存为本机材料
        </Button>
        <Badge variant="secondary">只存这台设备</Badge>
        <span className="text-xs leading-relaxed text-muted-foreground">
          自建材料没有人工审定的参考译文时，界面会明确标注不提供参考译文，不拿模型生成的译文冒充参考。
        </span>
      </div>
    </section>
  );
}

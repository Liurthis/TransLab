import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ISSUE_LABELS, SEVERITY_LABELS, type IssueCategory, type Severity } from "../types";
import { RUBRIC, deductionPoints } from "../data/rubric";

const CATEGORIES = Object.keys(ISSUE_LABELS) as IssueCategory[];
const SEVERITIES: Severity[] = ["light", "moderate", "severe"];

const CATEGORY_NOTE: Record<IssueCategory, string> = {
  mistranslation: "译文与原文含义不符，包括译反、译偏、术语错译。",
  omission: "原文有、译文无，包括整句、从句和限定词漏译。",
  wording: "意思对但选词不当，含语域不符、搭配生硬、直译痕迹。",
  grammar: "中文自身的语法、标点与句子完整性问题。",
  logic: "句间与句内逻辑关系（因果、转折、递进）被改变或含混。",
};

export function RubricPage() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{RUBRIC.title}</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          满分 {RUBRIC.totalScore} 分。先把满分按材料句数<strong className="font-medium text-foreground">均分</strong>，
          再对每一句按下方权重扣分，单句扣至 {RUBRIC.sentenceFloor} 分为止，各句得分相加即为总分。
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <div id="rubric-table" className="rounded-lg border border-border">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead>错误类型</TableHead>
              <TableHead>含义</TableHead>
              {SEVERITIES.map((severity) => (
                <TableHead key={severity} className="text-right">
                  {SEVERITY_LABELS[severity]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {CATEGORIES.map((category) => (
              <TableRow key={category}>
                <TableCell className="whitespace-nowrap font-medium">
                  {ISSUE_LABELS[category]}
                </TableCell>
                <TableCell className="text-xs leading-relaxed text-muted-foreground">
                  {CATEGORY_NOTE[category]}
                </TableCell>
                {SEVERITIES.map((severity) => (
                  <TableCell key={severity} className="text-right tabular-nums">
                    −{deductionPoints(RUBRIC, category, severity)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        <p className="text-xs text-muted-foreground sm:hidden">
          ← 左右滑动可查看"一般"与"严重"两档扣分
        </p>
      </div>

      <section className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
        <h3 className="text-base font-medium text-foreground">为什么是“均分制”</h3>
        <p>
          扣分制最容易失真的是“一处严重错误拖垮整篇”。均分制让每句独立计分，
          一处重错最多只影响该句的得分，总分因此更贴近真实阅卷的观感，
          也让你能看懂<strong className="font-medium text-foreground">某一句的分数是怎么来的</strong>。
        </p>
        <p>
          权重全部写在数据文件里，改数字不需要动界面代码。一旦拿到可靠的官方评分细则，
          只需替换这一份配置即可。
        </p>
      </section>
    </div>
  );
}

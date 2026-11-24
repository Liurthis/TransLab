import { AlertTriangle } from "lucide-react";

/**
 * 只在当前展示的是内置示例分析时显示。
 * 真实调用（isMock = false）时整块消失：写死的「尚未接入大模型」
 * 会在真实评分已经跑通的情况下，对每个用户说假话。
 */
export function MockBanner({ mock }: { mock: boolean }) {
  if (!mock) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
        <span className="font-medium">演示数据：</span>
        下面这份评分与逐句错误分析来自内置示例译文，
        <strong className="font-semibold"> 不是对模型真实调用的结果</strong>
        。对你自己的译文做真实评分请用「提交评分」。
      </p>
    </div>
  );
}

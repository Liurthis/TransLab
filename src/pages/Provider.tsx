import { useState } from "react";
import { Eye, EyeOff, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  clearProviderSetting,
  loadProvider,
  saveProviderSetting,
  storageState,
} from "../lib/storage";

const PLACEHOLDER_BASE_URL = "例如 http://localhost:1234/v1（LM Studio）或 https://api.deepseek.com/v1";

export function ProviderPage() {
  const stored = loadProvider();
  const storage = storageState();
  const [enabled, setEnabled] = useState(stored?.enabled ?? false);
  const [baseUrl, setBaseUrl] = useState(stored?.baseUrl ?? "");
  const [model, setModel] = useState(stored?.model ?? "");
  const [apiKey, setApiKey] = useState(stored?.apiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    const result = saveProviderSetting({ enabled, baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() });
    setMessage(
      result.ok
        ? enabled
          ? "已保存到这台浏览器。之后每次评分都发往上面填写的地址。"
          : "已保存（开关未开启，评分仍走部署默认模型）。"
        : "保存失败：本机存储写入被拒绝。",
    );
  };

  const clear = () => {
    clearProviderSetting();
    setEnabled(false);
    setBaseUrl("");
    setModel("");
    setApiKey("");
    setMessage("已清除，恢复使用部署配置的模型。");
  };

  const complete = Boolean(baseUrl.trim() && model.trim() && apiKey.trim());

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">模型接入</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          默认情况下，评分使用服务端环境变量配置的模型。开启下面的开关并填写三项后，
          评分与文档批改请求会携带这份配置，模型调用改发往你填写的地址——任何
          OpenAI 兼容服务都可以（云端服务商，或 LM Studio、Ollama 等本地模型）。
        </p>
        {storage !== "ok" && (
          <p className="max-w-2xl rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            本机存储不可用，这份配置存不住，关掉页面就没了。
          </p>
        )}
      </section>

      <div className="flex max-w-2xl flex-col gap-4 rounded-lg border border-border bg-card p-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-4 accent-primary"
          />
          启用自带模型配置
          {enabled && complete ? (
            <Badge variant="secondary">生效中</Badge>
          ) : (
            <Badge variant="outline">{enabled ? "待填写完整" : "未启用"}</Badge>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>模型服务地址（Base URL）</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={PLACEHOLDER_BASE_URL}
            spellCheck={false}
            autoComplete="off"
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>模型名</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="例如 qwen3.7-flash、deepseek-chat，或本地模型加载后显示的名称"
            spellCheck={false}
            autoComplete="off"
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>API Key</span>
          <div className="flex items-center gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="云端服务商必填；本地服务随便填一个非空值"
              spellCheck={false}
              autoComplete="off"
              className="flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={showKey ? "隐藏密钥" : "显示密钥"}
              onClick={() => setShowKey((current) => !current)}
            >
              {showKey ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={save} disabled={storage !== "ok"}>
            <Save />
            保存
          </Button>
          <Button size="sm" variant="outline" onClick={clear}>
            <Trash2 />
            清除并恢复默认
          </Button>
          {message && <span className="text-xs text-muted-foreground">{message}</span>}
        </div>
      </div>

      <section className="max-w-2xl flex flex-col gap-2 rounded-lg border border-dashed border-border p-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          这份配置（包括 Key）只存在这台浏览器的 localStorage 里：提交评分时随请求发给本站后端，
          后端仅用它转发到你填写的模型地址，服务端不存储、不记录密钥内容。
        </p>
        <p>
          因此不要在这台服务不信任的部署上填付费 Key；共享电脑用完请点「清除」。
        </p>
        <p>
          后端需要以 <code>ALLOW_USER_PROVIDER=true</code> 启动才接受自带配置，
          否则提交评分会返回 <code>provider_not_enabled</code>。本地跑法见仓库 README。
        </p>
      </section>
    </div>
  );
}

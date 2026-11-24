import { useMemo, useState } from "react";
import { ArrowRight, Layers, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DIRECTION_LABELS, type Material } from "../types";
import { MATERIALS } from "../data/materials";
import { loadUserMaterials, deleteUserMaterial, storageState, getAllMaterials } from "../lib/storage";
import { sourceLength } from "../lib/segment";
import { navigate } from "../lib/router";
import { NewMaterialPanel } from "./NewMaterial";

export function MaterialsPage() {
  const [userMaterials, setUserMaterials] = useState<Material[]>(() => loadUserMaterials());
  const [showForm, setShowForm] = useState(false);
  const storage = useMemo(() => storageState(), []);

  const materials = useMemo(() => getAllMaterials(), [userMaterials]);

  const remove = (material: Material) => {
    const result = deleteUserMaterial(material.id);
    if (!result.ok) return;
    setUserMaterials(loadUserMaterials());
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 id="site-title" className="text-2xl font-semibold tracking-tight">
          翻译练习材料
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          选择一篇材料，按句写出译文。提交后系统按 CATTI
          二级笔译的两个方向（英译汉、汉译英）逐句定位五类常见错误，给出修改建议，
          以及值得积累的英文表达与词汇。
        </p>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          自建材料与练习结果只保存在这台设备的浏览器里，不上传、不跨设备同步；清除浏览器数据会一并丢失。
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => setShowForm((value) => !value)}>
          <Layers />
          {showForm ? "收起新建材料" : "添加自己的文章"}
        </Button>
        {storage !== "ok" && (
          <span className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
            这台设备的浏览器存储不可用（隐私模式或嵌入式浏览器），自建材料与保存结果功能暂不可用。
          </span>
        )}
      </div>

      {showForm && (
        <NewMaterialPanel
          onSaved={(material) => {
            setUserMaterials(loadUserMaterials());
            setShowForm(false);
            navigate(`/practice/${material.id}`);
          }}
        />
      )}

      <div id="materials-list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {materials.map((material) => {
          const words = material.sentences.reduce(
            (total, sentence) => total + sourceLength(sentence.source, material.direction),
            0,
          );
          return (
            <div
              key={material.id}
              className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
            >
              <button
                type="button"
                onClick={() => navigate(`/practice/${material.id}`)}
                className="flex flex-col gap-3 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-medium text-card-foreground">
                    {material.title}
                  </h3>
                  <Badge variant="secondary">{material.difficulty}</Badge>
                </div>

                <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {material.sentences[0]?.source}
                </p>
              </button>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{DIRECTION_LABELS[material.direction]}</Badge>
                  <span>
                    {material.sentences.length} 句 ·{" "}
                    {words} {material.direction === "en2zh" ? "词" : "字"} ·{" "}
                    {material.register}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  {material.origin === "user" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(material)}
                      aria-label={`删除自建材料 ${material.title}`}
                    >
                      <Trash2 />
                    </Button>
                  ) : (
                    <span className="text-[11px]">内置</span>
                  )}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        内置示例材料说明：
        {MATERIALS[0]?.sourceNote}
      </p>
    </div>
  );
}

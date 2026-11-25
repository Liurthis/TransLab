import { useMemo, useState } from "react";
import { ArrowRight, Layers, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DIRECTION_LABELS, type Material } from "../types";
import { MATERIALS } from "../data/materials";
import { loadUserMaterials, deleteUserMaterial, deleteDraft, storageState, getAllMaterials } from "../lib/storage";
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
    deleteDraft(material.id);
    setUserMaterials(loadUserMaterials());
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 id="site-title" className="text-2xl font-semibold tracking-tight">
          CATTI 笔译训练材料
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          TransLab 是一个专注 CATTI
          笔译的训练站点：选一篇材料按句写出译文，提交后按英译汉、汉译英两个方向逐句定位误译、漏译、用词不当、语法问题与逻辑问题，
          按版本化评分表算分，并给出修改建议与值得积累的英文表达、词汇。
        </p>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          自建材料与练习结果只保存在这台设备的浏览器里，不上传、不跨设备同步；清除浏览器数据会一并丢失。
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => setShowForm((value) => !value)}>
          <Layers />
          {showForm ? "收起新建材料" : "添加文章"}
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
                  <span className="text-[11px]">开始练习</span>
                  {material.origin === "user" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(material)}
                      aria-label={`删除自建材料 ${material.title}`}
                    >
                      <Trash2 />
                    </Button>
                  )}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

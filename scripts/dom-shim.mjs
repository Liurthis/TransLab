// scripts/dom-shim.mjs
//
// 校验脚本在 Node 里直接加载前端源码，需要顶替两样浏览器才有、Node 没有的东西：
// 1) DOMParser —— 用 devDependency @xmldom/xmldom 代替（只在脚本里，不进前端产物）；
// 2) 相对导入补 .ts —— src/ 里的导入不带后缀（Vite 打包时补全），Node 原生 ESM 解析器不认。
// 生产页面用的是浏览器自带 DOMParser 与 Vite 解析，与本文件无关。

import { registerHooks } from "node:module";
import { DOMParser as XmlDomParser } from "@xmldom/xmldom";

export function installTsResolver() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const isExtensionlessRelative =
        /^\.{1,2}\//.test(specifier) && !/\.[a-zA-Z]+$/.test(specifier);
      if (!isExtensionlessRelative) return nextResolve(specifier, context);
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(specifier, context);
      }
    },
  });
}

export function installDomParser() {
  globalThis.DOMParser = class {
    parseFromString(source) {
      // 致命错误直接抛出、且不打印第三方实现的原文：浏览器那条路是靠 parsererror 节点报错，
      // 两条路都必须"失败得看得见"，不能被静默降级成半截正文。
      return new XmlDomParser({
        onError: (level, message) => {
          if (level === "fatalError") throw new Error(message);
        },
      }).parseFromString(source, "application/xml");
    }
  };
}

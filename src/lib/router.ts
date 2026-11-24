import { useEffect, useState } from "react";

function normalize(hash: string): string {
  const raw = hash.replace(/^#/, "");
  return raw.startsWith("/") ? raw : "/";
}

export function useHashRoute(): string {
  const [path, setPath] = useState(() => normalize(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setPath(normalize(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return path;
}

export function navigate(path: string) {
  window.location.hash = path;
}

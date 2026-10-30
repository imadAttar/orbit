import { create } from "zustand";
import { EMPTY_PREVIEW, previewReducer, type PreviewAction, type PreviewView } from "./previewModel";

interface PreviewStore {
  views: Record<string, PreviewView>;
  width: number;
  dispatch: (projectId: string, action: PreviewAction) => void;
  setWidth: (width: number) => void;
}
/** UI-only, project-scoped and never persisted into conversations or Claude settings. */
export const usePreviewStore = create<PreviewStore>((set) => ({
  views: {}, width: 480,
  dispatch: (projectId, action) => set(s => ({ views: { ...s.views, [projectId]: previewReducer(s.views[projectId] ?? EMPTY_PREVIEW, action) } })),
  setWidth: width => set({ width: Math.max(340, Math.min(900, width)) }),
}));

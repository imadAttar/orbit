import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ scrollback: { load: vi.fn().mockResolvedValue(null), clear: vi.fn() }, listen: vi.fn() }));
import { useStore, freshSessionIds } from "../../core/store";
import { scrollback } from "../../core/api";
import { useTerminalRestore } from "../../features/terminal/hooks/useTerminalRestore";
const mount = (sessionType?: "claude" | "terminal") => {
 const dp = vi.fn();
 renderHook(() => useTerminalRestore({sessionId:"s",activated:true,generation:0,restoreChoice:"pending",modeChoice:"normal",termRef:{current:null},spawnedRef:{current:false},sessionType,dp}));
 return dp;
};
beforeEach(() => { freshSessionIds.clear(); useStore.setState({ projects:[{id:"p",name:"P",dir:"/p",sessions:[{id:"s",name:"Main",claudeSessionId:"saved",hasConversation:true}]}] }); });
afterEach(cleanup);
it("offers the stored conversation even if scrollback is absent", async () => {
 const dp=mount();
 await vi.waitFor(() => expect(dp).toHaveBeenCalledWith({type:"setRestore",value:"ask"}));
});
it("restores terminal history without pretending to resume the shell process", () => {
 const dp=mount("terminal");
 expect(dp).toHaveBeenCalledWith({type:"setRestore",value:"resume"});
});
it("does not discard conversation recovery when reading history fails", async () => {
 vi.mocked(scrollback.load).mockRejectedValueOnce(new Error("fixture read failure"));
 const dp = mount();
 await vi.waitFor(() => expect(dp).toHaveBeenCalledWith({type:"setRestore",value:"ask"}));
 expect(dp).not.toHaveBeenCalledWith({type:"setRestore",value:"fresh"});
});

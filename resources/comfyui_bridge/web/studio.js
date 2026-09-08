import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "LTX.Studio.Bridge",
  setup() {
    window.addEventListener("message", async (event) => {
      if (window.parent === window || event.source !== window.parent) return;
      // The host controls this iframe. Never reply to unrelated frames/windows.
      const message = event.data;
      if (!message || typeof message.requestId !== "string") return;
      const reply = (data) => event.source.postMessage(
        { ...data, requestId: message.requestId }, event.origin === "null" ? "*" : event.origin,
      );
      try {
        if (message.type === "ltx:export") {
          const graph = await app.graphToPrompt();
          reply({ type: "ltx:graph", prompt: graph.output, workflow: graph.workflow });
        } else if (message.type === "ltx:load") {
          if (!message.workflow || !Array.isArray(message.workflow.nodes)) throw new Error("This workflow has no editable graph.");
          await app.loadGraphData(message.workflow);
          reply({ type: "ltx:loaded" });
        }
      } catch (error) {
        reply({ type: "ltx:error", error: error instanceof Error ? error.message : String(error) });
      }
    });
  },
});

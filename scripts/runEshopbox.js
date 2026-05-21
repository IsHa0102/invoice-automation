import { runEshopboxWorkflow } from "../src/workflows/eshopboxWorkflow.js";

runEshopboxWorkflow().catch((err) => {
  console.error("[fatal] Eshopbox workflow failed:", err);
  process.exitCode = 1;
});
import { runEshopboxWorkflow } from "./workflows/eshopboxWorkflow.js";

runEshopboxWorkflow().catch((err) => {
  console.error("[fatal] App failed:", err);
  process.exitCode = 1;
});

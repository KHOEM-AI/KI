import { Router, type IRouter } from "express";
import {
  GetKiStatusResponse,
  RunKiQueryBody,
  RunKiQueryResponse,
  SetKiKillSwitchBody,
  SetKiKillSwitchResponse,
} from "@workspace/api-zod";
import { orchestrate, getRecentActivity, type KiChannel } from "../ki/core/orchestrator";
import {
  getShieldState,
  setKillSwitch,
  ShieldError,
} from "../ki/security/shield";

const router: IRouter = Router();
const stages = [
  { name: "identity", label: "Identity", status: "ready" as const },
  { name: "access", label: "Access control", status: "ready" as const },
  { name: "input_guard", label: "Input guard", status: "guarded" as const },
  { name: "memory", label: "Memory", status: "ready" as const },
  { name: "router", label: "Model router", status: "ready" as const },
  { name: "output_guard", label: "Output guard", status: "guarded" as const },
  { name: "save_memory", label: "Save memory", status: "ready" as const },
];

function statusResponse() {
  return GetKiStatusResponse.parse({
    ...getShieldState(),
    model: "gpt-4.1-mini",
    stages,
    recent_activity: getRecentActivity(),
  });
}

router.get("/ki/status", (_req, res) => {
  res.json(statusResponse());
});

router.post("/ki", async (req, res) => {
  const parsed = RunKiQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide a valid query, user, and role." });
    return;
  }

  try {
    const result = await orchestrate({
      ...parsed.data,
      channel: (parsed.data.channel ?? "web") as KiChannel,
    });
    res.json(RunKiQueryResponse.parse(result));
  } catch (error) {
    const statusCode = error instanceof ShieldError ? error.statusCode : 500;
    const message =
      error instanceof Error ? error.message : "KI could not complete the request.";
    req.log.error({ err: error, statusCode }, "KI request failed");
    res.status(statusCode).json({ error: message });
  }
});

router.post("/ki/kill-switch", (req, res) => {
  const parsed = SetKiKillSwitchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The kill switch requires an enabled boolean." });
    return;
  }

  res.json(
    SetKiKillSwitchResponse.parse({
      ...setKillSwitch(parsed.data.enabled),
      model: "gpt-4.1-mini",
      stages,
      recent_activity: getRecentActivity(),
    }),
  );
});

export default router;

import { GameShell } from "../../components/GameShell";
import { demoSnapshot } from "../../components/demo-data";
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario } = await searchParams;
  const snapshot = structuredClone(demoSnapshot);
  if (scenario === "empty") {
    snapshot.character = null;
    snapshot.startedAt = null;
    snapshot.abilities = [];
    snapshot.entities = [];
    snapshot.results = [];
    snapshot.totalXp = 0;
  }
  if (scenario === "pending") {
    snapshot.unprocessedCount = 4;
    snapshot.jobs = ["waiting", "running", "failed", "budget_blocked"].map(
      (status, i) => ({
        requestId: `synthetic-request-${i}`,
        jobId: `synthetic-job-${i}`,
        eventId: null,
        recordStatus: "recorded",
        judgmentStatus: status as
          "waiting" | "running" | "failed" | "budget_blocked",
        resultId: null,
        revision: 3,
        playerResult: null,
        nextAction:
          status === "running"
            ? "poll"
            : status === "failed"
              ? "retry"
              : "continue",
        predecessorJobId: null,
        unprocessedCount: 4,
        errorCode: status === "failed" ? "SYNTHETIC_RESPONSE_ERROR" : null,
      }),
    );
  }
  if (scenario === "long" && snapshot.character) {
    snapshot.character.name =
      "일곱 번째 새벽의 잊히지 않는 별빛을 수호하는 이름 없는 순례자";
    snapshot.results[0].scene = snapshot.results[0].scene.repeat(6);
    snapshot.abilities.push(
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `long-${i}`,
        name: `오래된 별의 잔향을 해석하는 감각 ${i + 1}`,
        meaning: "합성 자료: 긴 이름과 가변 개수의 능력 표시 검증",
        value: i + 1,
        changeReason: null,
      })),
    );
  }
  return <GameShell demo initial={snapshot} />;
}

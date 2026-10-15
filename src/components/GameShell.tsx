"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommandInput,
  JobDTO,
  PlayerEntity,
  PlayerResult,
  PlayerSnapshot,
} from "../lib/contracts";

const sections = [
  ["home", "✧", "모험가의 서재"],
  ["character", "♜", "캐릭터"],
  ["item", "⚔", "소지품"],
  ["quest", "◇", "퀘스트"],
  ["world", "◎", "세계 도감"],
  ["journal", "▤", "모험 일지"],
  ["records", "☷", "현실 기록"],
] as const;
type Section = (typeof sections)[number][0];
const statusLabels = {
  waiting: "앞선 이야기 뒤에 대기 중",
  running: "이야기에 반영 중",
  committed: "반영 완료",
  failed: "반영하지 못함",
  interrupted: "처리가 중단됨",
  budget_blocked: "판정 예산 부족",
  deleted: "삭제됨",
};
const truthLabels = {
  canon: "세계의 기록",
  belief: "인물의 말과 믿음",
  interpretation: "공개된 해석",
};
const empty: PlayerSnapshot = {
  revision: 0,
  worldSequence: 0,
  startedAt: null,
  level: 1,
  totalXp: 0,
  character: null,
  abilities: [],
  entities: [],
  results: [],
  jobs: [],
  events: [],
  unprocessedCount: 0,
};

function Reader({
  item,
  entities,
  onOpen,
  onClose,
}: {
  item: PlayerEntity | PlayerResult;
  entities: PlayerEntity[];
  onOpen: (e: PlayerEntity) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  }, []);
  const entity = "kind" in item ? item : null;
  return (
    <dialog
      ref={ref}
      className="reader"
      aria-labelledby="reader-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="reader-top">
        <span className="eyebrow">
          {entity
            ? truthLabels[entity.truth]
            : "ADVENTURE JOURNAL · 모험의 기록"}
        </span>
        <button
          onClick={onClose}
          aria-label="상세 닫기"
          className="icon-button"
        >
          ×
        </button>
      </div>
      <article className="reader-body">
        <h1 id="reader-title">
          {entity ? entity.name : (item as PlayerResult).title}
        </h1>
        <p className="gold">
          {entity
            ? entity.summary
            : `기록 · 판본 ${(item as PlayerResult).revision}`}
        </p>
        {entity && (
          <>
            <div className="entity-meta">
              {entity.status && <span>{entity.status}</span>}
              {entity.quantity !== null && <span>수량 {entity.quantity}</span>}
            </div>
            {!!entity.attributes?.length && (
              <dl className="attribute-list">
                {entity.attributes.map((a, i) => (
                  <div key={i}>
                    <dt>{a.name}</dt>
                    <dd>{a.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
        <div className="prose">
          {entity ? entity.detail : (item as PlayerResult).scene}
        </div>
        {!entity && <ChangeList changes={(item as PlayerResult).changes} />}
        {entity && entity.relatedIds.length > 0 && (
          <div className="related">
            <h3>이야기로 이어지는 길</h3>
            {entity.relatedIds
              .map((id) => entities.find((e) => e.id === id))
              .filter((e): e is PlayerEntity => !!e)
              .map((e) => (
                <button key={e.id} onClick={() => onOpen(e)}>
                  {e.name} ↗
                </button>
              ))}
          </div>
        )}
      </article>
    </dialog>
  );
}
function ChangeList({ changes }: { changes: string[] }) {
  return (
    <ul className="changes">
      {changes.length ? (
        changes.map((c, i) => (
          <li key={i}>
            <span aria-hidden>✦</span>
            {c}
          </li>
        ))
      ) : (
        <li>이번 기록에는 확정된 성장 변화가 없습니다.</li>
      )}
    </ul>
  );
}

export function GameShell({
  demo = false,
  initial,
}: {
  demo?: boolean;
  initial?: PlayerSnapshot;
}) {
  const [data, setData] = useState<PlayerSnapshot>(initial ?? empty);
  const [section, setSection] = useState<Section>("home");
  const [reader, setReader] = useState<PlayerEntity | PlayerResult | null>(
    null,
  );
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [filter, setFilter] = useState("");
  const refresh = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/player", { cache: "no-store" });
      if (r.status === 401) {
        setAuthNeeded(true);
        return;
      }
      if (!r.ok)
        throw new Error(
          "모험의 서를 불러오지 못했습니다. 연결과 서비스 설정을 확인한 뒤 다시 조회해 주세요.",
        );
      setData(await r.json());
      setAuthNeeded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결을 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }, [demo]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Reading only: at most five requests while this page is visible.
  useEffect(() => {
    if (demo || !data.jobs.some((j) => j.judgmentStatus === "running")) return;
    let count = 0;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && count < 5) {
        count++;
        void refresh();
      }
      if (count >= 5) clearInterval(timer);
    }, 8000);
    return () => clearInterval(timer);
  }, [demo, data.jobs.some((j) => j.judgmentStatus === "running"), refresh]);
  async function mutate(path: string, body?: unknown, method = "POST") {
    if (demo) {
      setNotice("합성 미리보기입니다. 실제 기록과 세계는 변경되지 않습니다.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const payload = await r.json();
      if (!r.ok)
        throw new Error(
          payload.message ??
            (typeof payload.error === "string"
              ? `요청을 처리하지 못했습니다 (${payload.error}). 저장 상태를 다시 조회해 주세요.`
              : payload.error?.message) ??
            "요청을 처리하지 못했습니다. 저장 상태를 다시 확인해 주세요.",
        );
      setNotice(
        method === "DELETE"
          ? `현실 정보 삭제 완료 · 연결 정리 ${payload.cleanupStatus === "complete" ? "완료" : "상태 확인 필요"}. ${payload.externalRetention ?? ""}`
          : `요청 상태: ${statusLabels[(payload as JobDTO).judgmentStatus] ?? "접수됨"}`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  function command(
    kind: CommandInput["kind"],
    text: string,
    targetId: string | null = null,
  ) {
    const event = data.events.find((e) => e.id === targetId);
    void mutate("/api/commands", {
      requestKey: crypto.randomUUID(),
      expectedRevision: data.revision,
      kind,
      text,
      targetId,
      occurredAt: event?.occurredAt ?? null,
      uncertainty: event?.uncertainty ?? null,
      consent: event?.consent ?? null,
    } satisfies CommandInput);
  }
  const current = data.results[0];
  const entities = data.character && !data.entities.some((e) => e.id === data.character?.id)
    ? [data.character, ...data.entities]
    : data.entities;
  const grouped =
    section === "world"
      ? entities.filter((e) =>
          ["place", "npc", "faction", "lore", "relationship"].includes(e.kind),
        )
      : entities.filter((e) => e.kind === section);
  const filtered = grouped.filter((e) =>
    `${e.name} ${e.summary}`
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase()),
  );
  const go = (s: Section) => {
    setSection(s);
    setFilter("");
  };
  const entityCard = (entity: PlayerEntity) => (
    <button
      key={entity.id}
      className="entity-card"
      onClick={() => setReader(entity)}
    >
      <span className="entity-symbol" aria-hidden>
        {entity.kind === "item" ? "✦" : entity.kind === "npc" ? "♙" : "◇"}
      </span>
      <span>
        <small>
          {entity.status ? `${entity.status} · ` : ""}
          {entity.summary}
          {entity.quantity !== null ? ` · ×${entity.quantity}` : ""}
        </small>
        <strong>{entity.name}</strong>
        <p>{entity.detail.slice(0, 110)}</p>
      </span>
      <span className="arrow" aria-hidden>
        ↗
      </span>
    </button>
  );
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        본문으로 이동
      </a>
      <aside className="sidebar">
        <a href={demo ? "/demo" : "/"} className="brand">
          <span>✧</span>
          <div>
            LIFE RPG<small>모 험 의 서</small>
          </div>
        </a>
        <p className="nav-label">나의 이야기</p>
        <nav aria-label="모험 탐색">
          {sections.map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => go(id)}
              aria-current={section === id ? "page" : undefined}
            >
              <span aria-hidden>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-poem">
          <span>✦</span>
          <p>
            평범한 하루가
            <br />
            하나의 전설이 되도록.
          </p>
          <small>THE STORY CONTINUES</small>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <span>
            모험의 서 <i>/</i> {sections.find((s) => s[0] === section)?.[2]}
          </span>
          <div>
            <span className="connection">
              {demo ? "합성 세계 미리보기" : "나만의 모험"}
            </span>
            <button
              className="icon-button"
              aria-label="저장된 상태 새로 조회"
              disabled={loading || demo}
              onClick={() => void refresh()}
            >
              ↻
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              ✧ SYNTHETIC DEMO · 합성 데이터로 만든 미리보기입니다. 실제
              캐릭터·기록이 아닙니다.
            </span>
            <a href="/">나의 서재로 ↗</a>
          </div>
        )}
        {demo && (
          <nav className="demo-scenarios" aria-label="합성 검증 시나리오">
            <a href="/demo">기본 화면</a>
            <a href="/demo?scenario=pending">대기·실패·예산 부족</a>
            <a href="/demo?scenario=long">긴 장면·가변 능력</a>
            <a href="/demo?scenario=empty">첫 시작·빈 상태</a>
          </nav>
        )}
        <main id="main" tabIndex={-1}>
          <div role="status" aria-live="polite">
            {loading && <p className="status-note">모험의 서를 펼치는 중…</p>}
            {notice && <p className="status-note">{notice}</p>}
          </div>
          {error && (
            <div role="alert" className="error-note">
              {error}
              <button onClick={() => void refresh()}>다시 조회</button>
            </div>
          )}
          {authNeeded ? (
            <section className="welcome panel">
              <span className="eyebrow">YOUR STORY AWAITS</span>
              <h1>
                당신만의 모험에
                <br />
                다시 오신 것을 환영해요.
              </h1>
              <p>
                모험의 서는 지정된 주인만 열 수 있습니다.
                <br />
                이메일 인증 코드로 로그인해 주세요.
              </p>
              <a className="primary" href="/sign-in">
                모험의 서 열기 ↗
              </a>
              <a className="text-link" href="/demo">
                합성 화면 미리보기
              </a>
            </section>
          ) : (
            <>
              {data.unprocessedCount > 0 && (
                <section className="pending panel" aria-label="접수된 판정">
                  <h2>아직 이야기로 이어지는 중 · {data.unprocessedCount}건</h2>
                  <p>
                    이미 접수된 경험입니다. 조회는 판정을 시작하지 않습니다.
                  </p>
                  {data.jobs
                    .filter(
                      (j) =>
                        !["committed", "deleted"].includes(j.judgmentStatus),
                    )
                    .map((j) => (
                      <div className="job" key={j.jobId}>
                        <div>
                          <strong>{statusLabels[j.judgmentStatus]}</strong>
                          <small>
                            {j.recordStatus === "recorded"
                              ? "현실 기록 저장됨"
                              : "접수됨 · 기록 여부 미확정"}
                            {j.judgmentStatus === "budget_blocked"
                              ? " · 예산이 마련되면 이어 처리할 수 있습니다."
                              : ""}
                          </small>
                          {j.errorCode && (
                            <small>
                              진단 코드: {j.errorCode} · 요청 {j.requestId}
                            </small>
                          )}
                        </div>
                        {["continue", "retry"].includes(j.nextAction) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/api/jobs/${encodeURIComponent(j.jobId)}/continue`,
                              )
                            }
                          >
                            {j.nextAction === "retry"
                              ? "판정 다시 시도"
                              : "접수된 판정 이어 처리"}
                          </button>
                        )}
                        {j.nextAction === "answer" && (
                          <span>대화에서 필요한 사실에 답해 주세요.</span>
                        )}
                      </div>
                    ))}
                </section>
              )}
              {!data.character && !loading && !error && (
                <section className="welcome panel">
                  <span className="eyebrow">THE FIRST PAGE</span>
                  <h1>
                    아직 쓰이지 않은
                    <br />
                    당신의 첫 번째 이야기.
                  </h1>
                  <p>
                    현재 생성된 캐릭터와 모험 기록이 없습니다.
                    <br />
                    시작을 선택하면 레벨 1의 새로운 존재로 태어납니다.
                    <br />그 이후의 하루가 당신만의 세계에 쌓입니다.
                  </p>
                  <button
                    className="primary"
                    disabled={busy || data.unprocessedCount > 0}
                    onClick={() =>
                      command("start", "내 모험을 지금 시작하고 싶습니다.")
                    }
                  >
                    나의 모험 시작하기 ✦
                  </button>
                  <p className="muted">
                    탄생에는 판정 처리가 필요합니다. 접수와 확정 결과를 구분해
                    알려드립니다.
                  </p>
                  {!demo && (
                    <a href="/demo" className="text-link">
                      합성 화면 먼저 둘러보기 ↗
                    </a>
                  )}
                </section>
              )}
              {data.character && section === "home" && (
                <>
                  <section className="hero">
                    <div>
                      <span className="eyebrow">
                        YOUR ADVENTURE, STILL UNFOLDING
                      </span>
                      <p className="gold">{data.character.summary}</p>
                      <h1>{data.character.name}의 모험</h1>
                      <p>
                        오늘의 발자취가 내일의 전설이 되는 곳.
                        <br />
                        당신이 지나온 길과, 아직 펼쳐지지 않은 이야기를
                        만나세요.
                      </p>
                      <button
                        className="primary"
                        onClick={() => go("character")}
                      >
                        캐릭터 살펴보기 ↗
                      </button>
                    </div>
                    <span className="hero-caption">
                      ✦{" "}
                      {demo ? "안개의 달 · 합성 풍경" : "계속되는 나의 이야기"}
                    </span>
                  </section>
                  <div className="two-grid">
                    <section className="panel character-summary">
                      <span className="eyebrow">THE TRAVELER</span>
                      <div className="panel-heading">
                        <h2>{data.character.name}</h2>
                        <span className="level">
                          <small>LV.</small> {data.level}
                        </span>
                      </div>
                      <p>{data.character.summary}</p>
                      <div className="xp-line">
                        <span>쌓아 온 경험</span>
                        <strong>{data.totalXp.toLocaleString()} XP</strong>
                      </div>
                      <div className="abilities">
                        {data.abilities.map((a) => (
                          <div key={a.id}>
                            <span>{a.name}</span>
                            <strong>{a.value}</strong>
                          </div>
                        ))}
                      </div>
                      <button
                        className="text-link"
                        onClick={() => go("character")}
                      >
                        성장의 기록 ↗
                      </button>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">ACTIVE QUESTLINES</span>
                          <h2>이어지는 이야기</h2>
                        </div>
                        <button
                          className="text-link"
                          onClick={() => go("quest")}
                        >
                          모두 보기 ↗
                        </button>
                      </div>
                      {entities
                        .filter((e) => e.kind === "quest")
                        .slice(0, 3)
                        .map(entityCard)}
                      {!entities.some((e) => e.kind === "quest") && (
                        <p className="empty">
                          다음 이야기가 이곳에 이어집니다.
                        </p>
                      )}
                    </section>
                  </div>
                  {current && (
                    <section className="panel scene-panel">
                      <span className="eyebrow">THE LATEST CHAPTER</span>
                      <div className="panel-heading">
                        <h2>{current.title}</h2>
                        <button
                          className="text-link"
                          onClick={() => setReader(current)}
                        >
                          일지 펼치기 ↗
                        </button>
                      </div>
                      <p className="scene-excerpt">
                        {current.scene.slice(0, 420)}
                        {current.scene.length > 420 ? "…" : ""}
                      </p>
                      <ChangeList changes={current.changes} />
                      {current.question && (
                        <p className="status-note">
                          확인이 필요한 이야기 · {current.question}
                        </p>
                      )}
                    </section>
                  )}
                  <div className="three-grid">
                    {(["item", "npc", "place"] as const).map((kind, i) => (
                      <section className="panel" key={kind}>
                        <span className="eyebrow">
                          {["EQUIPMENT", "COMPANIONS", "WORLD WHISPERS"][i]}
                        </span>
                        <h2>
                          {
                            [
                              "함께하는 소지품",
                              "여정에서 만난 이들",
                              "세계의 소식",
                            ][i]
                          }
                        </h2>
                        {entities
                          .filter((e) => e.kind === kind)
                          .slice(0, 2)
                          .map(entityCard)}
                        {!entities.some((e) => e.kind === kind) && (
                          <p className="empty">아직 남겨진 기록이 없습니다.</p>
                        )}
                      </section>
                    ))}
                  </div>
                </>
              )}
              {section === "character" && data.character && (
                <>
                  <div className="page-title">
                    <span className="eyebrow">THE TRAVELER</span>
                    <h1>한 존재의 이야기</h1>
                    <p>현재의 모습과, 여기까지 이어진 흔적.</p>
                  </div>
                  <div className="two-grid">
                    <section className="panel character-detail">
                      <div className="sigil" aria-hidden>
                        ✧
                      </div>
                      <h2>{data.character.name}</h2>
                      <p className="gold">
                        LEVEL {data.level} · 누적 {data.totalXp} XP
                      </p>
                      <div className="prose">{data.character.detail}</div>
                    </section>
                    <section className="panel">
                      <span className="eyebrow">GIFTS & ABILITIES</span>
                      <h2>당신에게 깃든 힘</h2>
                      {data.abilities.map((a) => (
                        <div className="ability-detail" key={a.id}>
                          <div>
                            <h3>{a.name}</h3>
                            <p>{a.meaning}</p>
                            {a.changeReason && (
                              <p className="gold">{a.changeReason}</p>
                            )}
                          </div>
                          <strong>{a.value}</strong>
                        </div>
                      ))}
                      {!data.abilities.length && (
                        <p className="empty">아직 공개된 능력이 없습니다.</p>
                      )}
                    </section>
                  </div>
                  <section className="panel">
                    <span className="eyebrow">SKILLS · TRAITS · TITLES</span>
                    <h2>기술과 특성, 이름에 새겨진 것들</h2>
                    {entities
                      .filter((e) =>
                        [
                          "skill",
                          "trait",
                          "title",
                          "achievement",
                          "class",
                        ].includes(e.kind),
                      )
                      .map(entityCard)}
                    {!entities.some((e) =>
                      ["skill", "trait", "title", "achievement"].includes(
                        e.kind,
                      ),
                    ) && (
                      <p className="empty">
                        아직 공개된 기술·특성·칭호·업적이 없습니다.
                      </p>
                    )}
                  </section>
                  <section className="panel">
                    <h2>성장과 만남의 기록</h2>
                    {data.results.map((r) => (
                      <button
                        className="journal-row"
                        key={r.id}
                        onClick={() => setReader(r)}
                      >
                        <span>✦</span>
                        <div>
                          <strong>{r.title}</strong>
                          <small>
                            {r.changes.join(" · ") || "기록된 이야기"}
                          </small>
                        </div>
                        <span>↗</span>
                      </button>
                    ))}
                  </section>
                </>
              )}
              {["item", "quest", "world"].includes(section) && (
                <>
                  <div className="page-title">
                    <span className="eyebrow">
                      {section === "world"
                        ? "AN EVER UNFOLDING WORLD"
                        : "COLLECTION OF STORIES"}
                    </span>
                    <h1>{sections.find((s) => s[0] === section)?.[2]}</h1>
                    <p>
                      {section === "quest"
                        ? "당신의 삶에서 이어지는 이야기. 카드를 읽는 것으로 과업이 완료되지는 않습니다."
                        : "기록을 펼치고, 연결된 이야기로 걸어가 보세요."}
                    </p>
                  </div>
                  <label className="search">
                    기록 찾기
                    <input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="이름이나 설명으로 찾기"
                    />
                  </label>
                  <div className="collection-grid">
                    {filtered.map(entityCard)}
                  </div>
                  {!filtered.length && (
                    <section className="panel empty">
                      {filter
                        ? "일치하는 기록이 없습니다."
                        : "아직 이 페이지에 남겨진 기록이 없습니다."}
                    </section>
                  )}
                </>
              )}
              {section === "journal" && (
                <>
                  <div className="page-title">
                    <span className="eyebrow">ADVENTURE JOURNAL</span>
                    <h1>지나온 길의 기록</h1>
                    <p>하나의 장면이 다음 이야기의 시작이 됩니다.</p>
                  </div>
                  <section className="panel">
                    {data.results.map((r) => (
                      <button
                        className="journal-row"
                        key={r.id}
                        onClick={() => setReader(r)}
                      >
                        <span className="journal-number">
                          {r.revision.toString().padStart(2, "0")}
                        </span>
                        <div>
                          <small>
                            {new Date(r.createdAt).toLocaleDateString("ko-KR")}
                          </small>
                          <strong>{r.title}</strong>
                          <p>{r.scene.slice(0, 110)}…</p>
                        </div>
                        <span>↗</span>
                      </button>
                    ))}
                    {!data.results.length && (
                      <p className="empty">
                        첫 장면이 아직 기록되지 않았습니다.
                      </p>
                    )}
                  </section>
                </>
              )}
              {section === "records" && (
                <RecordPanel
                  data={data}
                  busy={busy}
                  demo={demo}
                  command={command}
                  remove={(id) =>
                    void mutate(
                      `/api/events/${encodeURIComponent(id)}`,
                      undefined,
                      "DELETE",
                    )
                  }
                />
              )}
            </>
          )}
          <footer>
            ✧ LIFE RPG{" "}
            <span>
              {demo
                ? "합성 미리보기 · 실제 데이터 아님"
                : `함께 쌓은 기록 · 판본 ${data.revision}`}{" "}
              · 세계는 대화 속에서 이어집니다.
            </span>
          </footer>
        </main>
      </div>
      {reader && (
        <Reader
          key={reader.id}
          item={reader}
          entities={entities}
          onOpen={setReader}
          onClose={() => setReader(null)}
        />
      )}
    </div>
  );
}

function RecordPanel({
  data,
  busy,
  demo,
  command,
  remove,
}: {
  data: PlayerSnapshot;
  busy: boolean;
  demo: boolean;
  command: (
    kind: CommandInput["kind"],
    text: string,
    targetId?: string | null,
  ) => void;
  remove: (id: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  // Event DTO is supplied by the server; no private material lives in the static UI.
  const events = data.events;
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">YOUR RECORDS, YOUR CHOICE</span>
        <h1>내 현실 기록</h1>
        <p>
          기록은 당신의 것입니다. 수정과 삭제는 보상 여부와 관계없이 요청할 수
          있습니다.
        </p>
      </div>
      <section className="panel">
        <h2>기록 관리</h2>
        {demo && (
          <p className="status-note">
            합성 미리보기에는 실제 현실 사건이 없습니다.
          </p>
        )}
        {!events.length ? (
          <p className="empty">관리할 현실 기록이 아직 없습니다.</p>
        ) : (
          <>
            <label>
              수정하거나 삭제할 기록
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setText(
                    events.find((v) => v.id === e.target.value)?.text ?? "",
                  );
                }}
              >
                <option value="">기록 선택</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.text.slice(0, 90)}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <>
                <p className="muted">
                  {events.find((e) => e.id === selected)?.occurredAt ??
                    "발생 시각 미지정"}{" "}
                  ·{" "}
                  {events.find((e) => e.id === selected)?.uncertainty ??
                    "별도 불확실성 없음"}
                </p>
                {events.find((e) => e.id === selected)?.consent && (
                  <div className="status-note">
                    동의한 현실 과업:{" "}
                    {events.find((e) => e.id === selected)?.consent?.task}
                    <br />
                    완료 조건:{" "}
                    {
                      events.find((e) => e.id === selected)?.consent
                        ?.completionCondition
                    }
                    <br />
                    동의 맥락:{" "}
                    {events.find((e) => e.id === selected)?.consent?.context}
                  </div>
                )}
                <label>
                  사실 내용
                  <textarea
                    value={text}
                    maxLength={12000}
                    onChange={(e) => setText(e.target.value)}
                    rows={6}
                  />
                </label>
                <div className="actions">
                  <button
                    disabled={busy || !text.trim()}
                    onClick={() => command("correct", text, selected)}
                  >
                    현실 기록 수정
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      remove(selected);
                      setSelected("");
                      setText("");
                    }}
                  >
                    선택한 현실 기록 삭제
                  </button>
                </div>
                <p className="muted">
                  삭제하면 관련 내용을 드러내는 이야기와 기억도 정리됩니다. 이미
                  표시된 ChatGPT 대화와 외부 제공자의 보존 자료는 서버에서 직접
                  삭제할 수 없습니다.
                </p>
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}

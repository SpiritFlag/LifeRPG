import type { PlayerSnapshot } from "../lib/contracts";

// Synthetic presentation fixture. Never used as a fallback for private API data.
export const demoSnapshot: PlayerSnapshot = {
  revision: 3,
  worldSequence: 3,
  startedAt: "2026-10-15T00:00:00Z",
  level: 1,
  totalXp: 24,
  character: {
    id: "demo-character",
    kind: "character",
    name: "이름 없는 별의 순례자",
    summary: "유리뼈 종족 · 새벽의 기록지기",
    detail:
      "몸 안에 작은 별빛을 품은 유리뼈의 존재. 기억이 사라진 항구에서 깨어나, 아직 쓰이지 않은 지도를 건네받았다.\n\n종족: 유리뼈\n직업: 새벽의 기록지기\n외형: 투명한 뼈 사이로 푸른 별빛이 흐르고, 낡은 청록 망토를 두르고 있다.\n시작 지역: 은빛 항구",
    truth: "canon",
    relatedIds: ["demo-place", "demo-item"],
    quantity: null,
  },
  abilities: [
    {
      id: "a1",
      name: "잔향을 듣는 감각",
      value: 7,
      meaning: "사물과 장소에 남은 작은 흔적을 느끼는 능력",
      changeReason: null,
    },
    {
      id: "a2",
      name: "마음을 잇는 온기",
      value: 4,
      meaning: "낯선 존재와 신뢰를 나누는 힘",
      changeReason: null,
    },
    {
      id: "a3",
      name: "별의 집중",
      value: 9,
      meaning: "흩어진 빛에서 길을 찾아내는 끈기",
      changeReason: null,
    },
  ],
  entities: [
    {
      id: "demo-skill",
      kind: "skill",
      name: "잔향 읽기",
      summary: "발견한 기술",
      detail:
        "사물에 남겨진 별빛의 결을 읽는다. 아직 작은 잔향만 들리지만, 집중할수록 더 많은 흔적이 모습을 드러낸다.",
      truth: "canon",
      relatedIds: ["demo-item"],
      quantity: null,
      status: "새로 발견",
      attributes: [
        { name: "숙련", value: "첫걸음" },
        { name: "성질", value: "별빛 · 감각" },
      ],
    },
    {
      id: "demo-trait",
      kind: "trait",
      name: "빛이 머무는 뼈",
      summary: "유리뼈 종족의 특성",
      detail:
        "당신의 뼈에는 빛이 오래 머문다. 어둠 속에서 작은 흔적을 드러내는 은은한 빛이다.",
      truth: "canon",
      relatedIds: ["demo-character"],
      quantity: null,
    },
    {
      id: "demo-title",
      kind: "title",
      name: "꺼지지 않는 작은 등불",
      summary: "첫 번째 칭호",
      detail:
        "세렌은 당신을 작은 등불이라고 불렀다. 거대한 불꽃은 아니어도 누군가의 길을 밝힐 수 있다는 뜻으로.",
      truth: "belief",
      relatedIds: ["demo-npc"],
      quantity: null,
    },
    {
      id: "demo-item",
      kind: "item",
      name: "아직 쓰이지 않은 별지도",
      summary: "장착 · 여정의 도구",
      detail:
        "빛을 비추면 지나온 길만 드러나는 지도. 앞으로 갈 곳은 비어 있지만, 그 여백은 어둡지 않다.\n\n획득: 은빛 항구의 첫 만남\n효과: 공개된 장소의 잔향을 읽는 데 도움을 준다.",
      truth: "canon",
      relatedIds: ["demo-npc", "demo-place"],
      quantity: 1,
    },
    {
      id: "demo-quest",
      kind: "quest",
      name: "등대가 기억하는 이름",
      summary: "첫 번째 장 · 진행 중",
      detail:
        "세렌은 등대의 불빛이 돌아온 밤을 기억한다. 오래된 장부의 빈 페이지와 항구의 노래는 같은 이름을 가리킨다. 이야기는 다음 경험과 함께 이어진다.",
      truth: "canon",
      relatedIds: ["demo-npc", "demo-place"],
      quantity: null,
    },
    {
      id: "demo-task",
      kind: "quest",
      name: "서재의 작은 등불",
      summary: "현실 과업 · 동의하여 등록됨",
      detail:
        "현실 할 일: 책상 위 서류를 정리하기\n완료 조건: 보관할 서류와 버릴 서류를 분류하고 책상을 비우기\n동의 내용: 이번 주 안에 한 번 정리하고 싶다고 동의함\n반복: 없음\n\n등록은 완료가 아니다. 실제로 수행한 경험을 이야기하면 반영된다.",
      truth: "canon",
      relatedIds: [],
      quantity: null,
    },
    {
      id: "demo-place",
      kind: "place",
      name: "은빛 항구",
      summary: "안개의 바다와 맞닿은 첫 번째 땅",
      detail:
        "아침마다 낮은 안개가 선착장에 머문다. 북쪽 절벽의 등대는 오래 잠들어 있었지만, 어젯밤 다시 불이 켜졌다.",
      truth: "canon",
      relatedIds: ["demo-npc", "demo-quest"],
      quantity: null,
    },
    {
      id: "demo-npc",
      kind: "npc",
      name: "등대지기 세렌",
      summary: "관계 · 조심스러운 신뢰",
      detail:
        "낡은 별지도를 간직한 등대지기. 말수가 적지만 길을 잃은 여행자에게는 언제나 따뜻한 차를 내어준다.\n\n“돌아오는 빛에는 저마다의 이름이 있지요.”",
      truth: "belief",
      relatedIds: ["demo-place", "demo-item", "demo-quest"],
      quantity: null,
    },
    {
      id: "demo-faction",
      kind: "faction",
      name: "새벽을 묶는 사람들",
      summary: "공개된 세력 · 항구의 기록 보관자",
      detail:
        "세대마다 항구의 노래와 지도를 이어받는 작은 공동체. 등대의 빛을 새로운 여정의 징표로 여긴다.",
      truth: "canon",
      relatedIds: ["demo-place"],
      quantity: null,
    },
  ],
  results: [
    {
      id: "demo-result",
      title: "파도 너머, 첫 번째 별",
      scene:
        "새벽이 오기 전의 바다는 유난히 고요했다.\n\n당신이 오래된 장부를 펼치자 종이 사이에서 가느다란 빛이 흘러나왔다. 세렌은 아무 말 없이 찻잔을 내려놓았다. 창밖의 등대가, 아주 오랜 잠에서 깨어난 것처럼 한 번 빛났다.\n\n“이제 길이 보이나요?”\n\n지도 위에는 이름 없는 바다가 있었다. 그리고 그 너머, 아직 아무도 읽지 못한 별 하나. 새로운 항해는 그렇게 시작되었다.",
      changes: [
        "별의 집중 8 → 9",
        "아직 쓰이지 않은 별지도 획득",
        "등대지기 세렌과 조심스러운 신뢰",
      ],
      question: null,
      createdAt: "2026-10-15T00:00:00Z",
      revision: 3,
    },
  ],
  jobs: [],
  events: [],
  unprocessedCount: 0,
};

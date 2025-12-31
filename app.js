/* PT 배틀타워 싱글 조언봇 (21+) - v2
 * - DB(JSON) 로드
 * - 파티 저장/불러오기(localStorage)
 * - 파티 포켓몬 이름도 수정 가능(p1_name/p2_name/p3_name)
 * - 상대 입력 -> 후보 세트 필터 -> 추천행동 + 이유 출력(룰 기반)
 */

const LS_PARTY_KEY = "bt_party_v2";
let DB = null;                 // { meta, sets: [...] }
let POKE_TYPES = new Map();    // pokemon_ko -> types_ko

const OHKO_MOVES_KO = new Set(["절대냉동", "땅가르기", "가위자르기", "뿔드릴"]); // Gen4 OHKO

// 4세대 타입(페어리 없음)
const TYPE_LIST = ["노말","불꽃","물","전기","풀","얼음","격투","독","땅","비행","에스퍼","벌레","바위","고스트","드래곤","악","강철"];

// 공격타입 -> 방어타입 배율
const TYPE_CHART = {
  "노말": {"바위":0.5,"고스트":0,"강철":0.5},
  "불꽃": {"불꽃":0.5,"물":0.5,"풀":2,"얼음":2,"벌레":2,"바위":0.5,"드래곤":0.5,"강철":2},
  "물": {"불꽃":2,"물":0.5,"풀":0.5,"땅":2,"바위":2,"드래곤":0.5},
  "전기": {"물":2,"전기":0.5,"풀":0.5,"땅":0,"비행":2,"드래곤":0.5},
  "풀": {"불꽃":0.5,"물":2,"풀":0.5,"독":0.5,"땅":2,"비행":0.5,"벌레":0.5,"바위":2,"드래곤":0.5,"강철":0.5},
  "얼음": {"불꽃":0.5,"물":0.5,"풀":2,"얼음":0.5,"땅":2,"비행":2,"드래곤":2,"강철":0.5},
  "격투": {"노말":2,"얼음":2,"독":0.5,"비행":0.5,"에스퍼":0.5,"벌레":0.5,"바위":2,"고스트":0,"악":2,"강철":2},
  "독": {"풀":2,"독":0.5,"땅":0.5,"바위":0.5,"고스트":0.5,"강철":0},
  "땅": {"불꽃":2,"전기":2,"풀":0.5,"독":2,"비행":0,"바위":2,"강철":2},
  "비행": {"전기":0.5,"풀":2,"격투":2,"벌레":2,"바위":0.5,"강철":0.5},
  "에스퍼": {"격투":2,"독":2,"에스퍼":0.5,"악":0,"강철":0.5},
  "벌레": {"불꽃":0.5,"풀":2,"격투":0.5,"독":0.5,"비행":0.5,"에스퍼":2,"고스트":0.5,"악":2,"강철":0.5},
  "바위": {"불꽃":2,"얼음":2,"격투":0.5,"땅":0.5,"비행":2,"벌레":2,"강철":0.5},
  "고스트": {"노말":0,"에스퍼":2,"고스트":2,"악":0.5,"강철":0.5},
  "드래곤": {"드래곤":2,"강철":0.5},
  "악": {"격투":0.5,"에스퍼":2,"고스트":2,"악":0.5,"강철":0.5},
  "강철": {"불꽃":0.5,"물":0.5,"전기":0.5,"얼음":2,"바위":2,"강철":0.5}
};

function multAgainst(defTypes, atkType){
  let m = 1.0;
  for (const dt of (defTypes || [])){
    const row = TYPE_CHART[atkType] || {};
    m *= (row[dt] ?? 1.0);
  }
  return m;
}
function stabMultiplier(moveType, userTypes){
  return (userTypes || []).includes(moveType) ? 1.5 : 1.0;
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }

// 값 -> 라벨
function labelThreat(x){
  if (x < 0.80) return "매우 유리";
  if (x < 1.10) return "유리";
  if (x < 1.60) return "보통";
  if (x < 2.30) return "불리";
  return "매우 불리";
}
function labelFirepower(x){
  if (x < 0.90) return "매우 낮음";
  if (x < 1.30) return "낮음";
  if (x < 1.80) return "보통";
  if (x < 2.60) return "높음";
  return "매우 높음";
}

// 게이지(시각화용): 대략적인 “체감 범위”로 정규화
function gaugeThreat(x){ return clamp01((x - 0.5) / (3.0 - 0.5)); }
function gaugeFirepower(x){ return clamp01((x - 0.6) / (2.8 - 0.6)); }

function barHtml(frac){
  const w = Math.round(clamp01(frac) * 100);
  return `<div class="bar"><div class="barFill" style="width:${w}%"></div></div>`;
}

function powerWeight(power){
  const p = Number(power ?? 0);
  if (!p) return 0.6; // 상태기 등
  return Math.min(1.4, Math.max(0.4, 0.4 + p/150));
}

function filterSetsByObservation(sets, itemObs, moveObs){
  let out = sets;
  if (itemObs && itemObs.trim()){
    out = out.filter(s => (s.item_ko || "").trim() === itemObs.trim());
  }
  if (moveObs && moveObs.trim()){
    out = out.filter(s => (s.moves || []).some(m => (m.name_ko || "").trim() === moveObs.trim()));
  }
  return out;
}

function threatScoreOpponentToMe(oppSet, myPoke){
  let best = 0;
  for (const mv of (oppSet.moves || [])){
    const mvName = mv.name_ko || "";

    if (OHKO_MOVES_KO.has(mvName)){
      best = Math.max(best, 2.5);
      continue;
    }

    const atkType = mv.type_ko || "노말";
    const eff = multAgainst(myPoke.types_ko, atkType);
    const stab = stabMultiplier(atkType, oppSet.types_ko || []);
    const pw = powerWeight(mv.power);

    let statusB = 1.0;
    if ((mv.damage_class_ko || "") === "변화" && mvName){
      if (["맹독","독","전기자석파","최면술","검은눈빛","도발","앙코르"].includes(mvName)) statusB = 1.25;
      else statusB = 1.05;
    }
    const score = eff * stab * pw * statusB;
    best = Math.max(best, score);
  }
  return best;
}

function bestAttackScoreMeToOpponent(myPoke, oppTypes, myTypes){
  let best = 0;
  for (const mv of (myPoke.moves || [])){
    const atkType = mv.type_ko || guessMoveTypeKo(mv.name_ko);
    const eff = multAgainst(oppTypes, atkType);
    const stab = stabMultiplier(atkType, myTypes);
    const pw = powerWeight(mv.power ?? guessMovePower(mv.name_ko));
    best = Math.max(best, eff * stab * pw);
  }
  return best;
}

// 아주 최소 추정(파티 기술 정도만 커버)
function guessMoveTypeKo(nameKo){
  const map = {
    "파도타기":"물","냉동빔":"얼음","10만볼트":"전기","명상":"에스퍼","잠자기":"에스퍼",
    "지진":"땅","역린":"드래곤","불꽃엄니":"불꽃","맹독":"독",
    "코멧펀치":"강철","불릿펀치":"강철","칼춤":"노말","대폭발":"노말"
  };
  return map[nameKo] || "노말";
}
function guessMovePower(nameKo){
  const map = {
    "파도타기":95,"냉동빔":95,"10만볼트":95,"지진":100,"역린":120,"불꽃엄니":65,
    "코멧펀치":100,"불릿펀치":40,"대폭발":250
  };
  return map[nameKo] || 0;
}

function inferTypesFromDb(nameKo){
  const key = (nameKo || "").trim();
  if (!key) return [];
  return POKE_TYPES.get(key) || [];
}

function decorateMyMoves(myPoke, db){
  const moveIndex = db?.meta?.moveIndex_ko || null;
  const moves = (myPoke.moves || []).map(m => {
    const base = {...m};
    if (moveIndex && moveIndex[m.name_ko]){
      base.type_ko = moveIndex[m.name_ko].type_ko;
      base.power = moveIndex[m.name_ko].power;
    } else {
      base.type_ko = guessMoveTypeKo(m.name_ko);
      base.power = guessMovePower(m.name_ko);
    }
    return base;
  });
  return {...myPoke, moves};
}

function buildMyPartyFromUI(){
  // 포켓몬 이름도 입력 가능 (DB 로드 후 타입 자동 추론)
  const p1_name = val("p1_name") || "스이쿤";
  const p2_name = val("p2_name") || "한카리아스";
  const p3_name = val("p3_name") || "메타그로스";

  const p1 = {
    name_ko: p1_name,
    item_ko: val("p1_item"),
    types_ko: inferTypesFromDb(p1_name),
    moves: [
      {name_ko: val("p1_m1")},
      {name_ko: val("p1_m2")},
      {name_ko: val("p1_m3")},
      {name_ko: val("p1_m4")}
    ].filter(m => m.name_ko && m.name_ko.trim())
  };

  const p2 = {
    name_ko: p2_name,
    item_ko: val("p2_item"),
    types_ko: inferTypesFromDb(p2_name),
    moves: [
      {name_ko: val("p2_m1")},
      {name_ko: val("p2_m2")},
      {name_ko: val("p2_m3")},
      {name_ko: val("p2_m4")}
    ].filter(m => m.name_ko && m.name_ko.trim())
  };

  const p3 = {
    name_ko: p3_name,
    item_ko: val("p3_item"),
    types_ko: inferTypesFromDb(p3_name),
    moves: [
      {name_ko: val("p3_m1")},
      {name_ko: val("p3_m2")},
      {name_ko: val("p3_m3")},
      {name_ko: val("p3_m4")}
    ].filter(m => m.name_ko && m.name_ko.trim())
  };

  return { p1, p2, p3 };
}

function recommend(activeKey, oppNameKo, itemObs, moveObs){
  if (!DB) return { ok:false, msg:"DB가 로드되지 않았습니다." };

  const party = buildMyPartyFromUI();
  const active = party[activeKey];

  if (!active?.types_ko?.length){
    return { ok:false, msg:`내 파티 '${active?.name_ko ?? activeKey}'의 타입을 DB에서 찾지 못했습니다. (DB 목록에 있는 한글명으로 입력/선택하세요)` };
  }

  const allOpp = DB.sets.filter(s => (s.pokemon_ko || "").trim() === (oppNameKo || "").trim());
  if (!allOpp.length) return { ok:false, msg:`DB에서 '${oppNameKo}'를 찾지 못했습니다.` };

  const cand = filterSetsByObservation(allOpp, itemObs, moveObs);
  const candSets = cand.length ? cand : allOpp;

  const oppTypes = candSets[0].types_ko || [];

  const meAtk = bestAttackScoreMeToOpponent(
    decorateMyMoves(active, DB),
    oppTypes,
    active.types_ko
  );

  const meThreat = Math.max(...candSets.map(s => threatScoreOpponentToMe(s, active)));

  const hasSetup = (active.moves || []).some(m => ["명상","칼춤"].includes(m.name_ko));
  const setupOk = hasSetup && meThreat < 1.05 && meAtk < 1.15;

  const garchomp = party.p2;
  const metagross = party.p3;

  const gAtk = garchomp.types_ko?.length ? bestAttackScoreMeToOpponent(decorateMyMoves(garchomp, DB), oppTypes, garchomp.types_ko) : -999;
  const mAtk = metagross.types_ko?.length ? bestAttackScoreMeToOpponent(decorateMyMoves(metagross, DB), oppTypes, metagross.types_ko) : -999;

  const gThreat = garchomp.types_ko?.length ? Math.max(...candSets.map(s => threatScoreOpponentToMe(s, garchomp))) : 999;
  const mThreat = metagross.types_ko?.length ? Math.max(...candSets.map(s => threatScoreOpponentToMe(s, metagross))) : 999;

  const scoreStayAttack = meAtk - meThreat;
  const scoreStaySetup  = (setupOk ? (meAtk + 0.25) : -999) - (meThreat + 0.25);
  const scoreToG = (gAtk - gThreat) + (1.0 - gThreat);
  const scoreToM = (mAtk - mThreat) + (1.0 - mThreat);

  const choices = [
    { action: "바로 공격", score: scoreStayAttack },
    { action: "랭크업(명상/칼춤)", score: scoreStaySetup },
    { action: `${garchomp.name_ko}로 교체`, score: scoreToG },
    { action: `${metagross.name_ko}로 교체`, score: scoreToM }
  ].sort((a,b) => b.score - a.score);

  const best = choices[0];

  const threatMoves = summarizeThreatMoves(candSets, active);

  // why는 "텍스트"와 "HTML(막대)"를 섞어도 깨지지 않게 구조화
  const why = [];
  why.push({kind:"text", text:`후보 세트: ${candSets.length}개 (관측 필터 ${cand.length ? "적용" : "미적용"})`});

  why.push({kind:"text", text:`상대의 최대 위협도(현재 선봉 기준): ${meThreat.toFixed(2)} (${labelThreat(meThreat)})`});
  why.push({kind:"html", html:barHtml(gaugeThreat(meThreat))});

  why.push({kind:"text", text:`내 즉시 화력(현재 선봉 기준): ${meAtk.toFixed(2)} (${labelFirepower(meAtk)})`});
  why.push({kind:"html", html:barHtml(gaugeFirepower(meAtk))});

  if (best.action.includes("교체")){
    const toG = best.action.includes(garchomp.name_ko);
    const t = toG ? gThreat : mThreat;
    const a = toG ? gAtk : mAtk;
    if (Number.isFinite(t) && Number.isFinite(a)){
      why.push({kind:"text", text:`교체 후 위협도: ${t.toFixed(2)}, 교체 후 화력: ${a.toFixed(2)}`});
    }
  }

  if (threatMoves.length){
    why.push({kind:"text", text:`주의 기술(후보 기준): ${threatMoves.join(", ")}`});
  }

  if (hasSetup){
    why.push({kind:"text", text: setupOk
      ? "랭크업은 ‘상대 위협이 낮고, 즉시 딜로 2~3턴 킬이 어려울 때’만 추천하도록 설정됨"
      : "랭크업은 한 턴을 비우는 행동이라, 상대 위협이 조금이라도 높으면 비추천으로 처리됨"
    });
  }

  return { ok:true, best, choices, why };
}

function summarizeThreatMoves(candSets, myPoke){
  const freq = new Map();
  for (const s of candSets){
    for (const mv of (s.moves || [])){
      const name = mv.name_ko || "";
      const type = mv.type_ko || "노말";
      const eff = multAgainst(myPoke.types_ko, type);
      const isKeyStatus = (mv.damage_class_ko === "변화") && ["맹독","전기자석파","최면술","앙코르","도발"].includes(name);
      const isOhko = OHKO_MOVES_KO.has(name);
      if (eff >= 2 || isKeyStatus || isOhko){
        freq.set(name, (freq.get(name) || 0) + 1);
      }
    }
  }
  return [...freq.entries()]
    .sort((a,b) => b[1]-a[1])
    .slice(0, 6)
    .map(([k,v]) => `${k}(${v}/${candSets.length})`);
}

/* ---------- UI wiring ---------- */

function el(id){ return document.getElementById(id); }
function val(id){
  const e = el(id);
  return (e && typeof e.value === "string") ? e.value.trim() : "";
}
function setVal(id, v){
  const e = el(id);
  if (e) e.value = v ?? "";
}

async function loadDb(path){
  const res = await fetch(path);
  if (!res.ok) throw new Error(`DB 로드 실패: ${res.status}`);
  DB = await res.json();

  // pokemon_ko -> types_ko 인덱스 구축
  POKE_TYPES = new Map();
  for (const s of (DB.sets || [])){
    const n = (s.pokemon_ko || "").trim();
    const t = Array.isArray(s.types_ko) ? s.types_ko.filter(Boolean) : [];
    if (n && t.length && !POKE_TYPES.has(n)) POKE_TYPES.set(n, t);
  }

  renderOppList();
  refreshActiveSelectLabels();

  el("dbStatus").textContent = `DB 로드됨: ${DB?.meta?.name ?? "(unknown)"} / sets=${DB?.sets?.length ?? 0}`;
}

function renderOppList(){
  const dl = el("oppList");
  if (!dl) return;
  dl.innerHTML = "";
  if (!DB) return;
  const names = [...new Set((DB.sets || []).map(s => (s.pokemon_ko || "").trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,"ko"));
  for (const n of names){
    const opt = document.createElement("option");
    opt.value = n;
    dl.appendChild(opt);
  }
}

function refreshActiveSelectLabels(){
  const sel = el("activeSelect");
  if (!sel) return;

  const p1 = val("p1_name") || "스이쿤";
  const p2 = val("p2_name") || "한카리아스";
  const p3 = val("p3_name") || "메타그로스";

  for (const opt of sel.options){
    if (opt.value === "p1") opt.textContent = p1;
    if (opt.value === "p2") opt.textContent = p2;
    if (opt.value === "p3") opt.textContent = p3;
  }
}

function saveParty(){
  const party = {
    p1_name: val("p1_name"), p1_item: val("p1_item"), p1_m1: val("p1_m1"), p1_m2: val("p1_m2"), p1_m3: val("p1_m3"), p1_m4: val("p1_m4"),
    p2_name: val("p2_name"), p2_item: val("p2_item"), p2_m1: val("p2_m1"), p2_m2: val("p2_m2"), p2_m3: val("p2_m3"), p2_m4: val("p2_m4"),
    p3_name: val("p3_name"), p3_item: val("p3_item"), p3_m1: val("p3_m1"), p3_m2: val("p3_m2"), p3_m3: val("p3_m3"), p3_m4: val("p3_m4")
  };
  localStorage.setItem(LS_PARTY_KEY, JSON.stringify(party));
  el("partyStatus").textContent = "저장 완료 (localStorage)";
  refreshActiveSelectLabels();
}

function loadParty(){
  const raw = localStorage.getItem(LS_PARTY_KEY);
  if (!raw){
    el("partyStatus").textContent = "저장된 파티가 없습니다.";
    return;
  }
  const party = JSON.parse(raw);
  for (const [k,v] of Object.entries(party)) setVal(k, v);
  el("partyStatus").textContent = "불러오기 완료";
  refreshActiveSelectLabels();
}

function resetParty(){
  localStorage.removeItem(LS_PARTY_KEY);
  [
    "p1_name","p1_item","p1_m1","p1_m2","p1_m3","p1_m4",
    "p2_name","p2_item","p2_m1","p2_m2","p2_m3","p2_m4",
    "p3_name","p3_item","p3_m1","p3_m2","p3_m3","p3_m4"
  ].forEach(id => setVal(id,""));
  el("partyStatus").textContent = "초기화 완료";
  refreshActiveSelectLabels();
}

function renderResult(rec){
  const box = el("resultBox");
  if (!box) return;

  if (!rec.ok){
    box.innerHTML = `<h3>오류</h3><div class="mono">${escapeHtml(rec.msg)}</div>`;
    return;
  }

  const lines = [];
  lines.push(`<h3>추천: ${escapeHtml(rec.best.action)}</h3>`);
  lines.push(`<div class="small">점수(상대적): ${rec.best.score.toFixed(2)} / 2~4위: ${rec.choices.slice(1,4).map(c=>`${c.action}(${c.score.toFixed(2)})`).join(" · ")}</div>`);
  lines.push("<hr class='sep'/>");
  lines.push("<ul>");

  for (const w of (rec.why || [])){
    if (typeof w === "string"){
      lines.push(`<li>${escapeHtml(w)}</li>`);
    } else if (w && w.kind === "html"){
      // 우리가 생성한 barHtml만 넣는 용도(외부 입력 X)
      lines.push(`<li>${w.html}</li>`);
    } else if (w && w.kind === "text"){
      lines.push(`<li>${escapeHtml(w.text)}</li>`);
    }
  }
  lines.push("</ul>");
  box.innerHTML = lines.join("\n");
}

function escapeHtml(s){
  return (s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}

function initDefaults(){
  // 기본값
  if (!localStorage.getItem(LS_PARTY_KEY)){
    setVal("p1_name","스이쿤");
    setVal("p1_item","먹다남은음식");
    setVal("p1_m1","파도타기");
    setVal("p1_m2","냉동빔");
    setVal("p1_m3","10만볼트");
    setVal("p1_m4","잠자기");

    setVal("p2_name","한카리아스");
    setVal("p2_item","리샘열매");
    setVal("p2_m1","지진");
    setVal("p2_m2","역린");
    setVal("p2_m3","맹독");
    setVal("p2_m4","불꽃엄니");

    setVal("p3_name","메타그로스");
    setVal("p3_item","생명의구슬");
    setVal("p3_m1","칼춤");
    setVal("p3_m2","불릿펀치");
    setVal("p3_m3","코멧펀치");
    setVal("p3_m4","대폭발");
  } else {
    loadParty();
  }

  refreshActiveSelectLabels();
}

window.addEventListener("load", () => {
  initDefaults();

  // 파티 포켓몬 이름 바꿀 때, 선봉 드롭다운 라벨도 같이 갱신
  ["p1_name","p2_name","p3_name"].forEach(id => {
    const e = el(id);
    if (e) e.addEventListener("input", refreshActiveSelectLabels);
  });

  el("btnLoadDb")?.addEventListener("click", async () => {
    try {
      await loadDb(el("dbSelect").value);
    } catch (e) {
      el("dbStatus").textContent = `DB 로드 실패: ${e.message}`;
    }
  });

  el("btnSaveParty")?.addEventListener("click", saveParty);
  el("btnLoadParty")?.addEventListener("click", loadParty);
  el("btnResetParty")?.addEventListener("click", resetParty);

  el("btnRecommend")?.addEventListener("click", () => {
    const active = el("activeSelect").value;
    const opp = val("oppName");
    const itemObs = val("oppItemObs");
    const moveObs = val("oppMoveObs");

    if (!opp){
      renderResult({ok:false, msg:"상대 포켓몬을 입력하세요."});
      return;
    }
    const rec = recommend(active, opp, itemObs, moveObs);
    renderResult(rec);
  });

  // (선택) PWA 서비스워커
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("service-worker.js").catch(()=>{});
  }
});

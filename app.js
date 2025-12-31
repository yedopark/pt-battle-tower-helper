/* PT 배틀타워 싱글 조언봇 (21+) - 개선판
 * - DB(JSON) 로드
 * - 내 파티: 포켓몬/타입/기술/아이템 수정 가능
 * - "파티 입력완료(검증)" 버튼: DB 존재/오탈자 점검 + 빨간 표시
 * - 추천 시: "바로 공격이면 어떤 기술로"까지 제시
 * - 파티 저장: 자동 이름(예: 스이-크레-히드)로 여러 파티 누적 저장 + 삭제 전까지 유지
 * - 점수/후보는 고급 정보로 접기
 */

const LS_BOOK_KEY = "bt_party_book_v2";
const LS_LAST_KEY = "bt_party_last_v2";

let DB = null;          // { meta, sets: [...] }
let IDX = null;         // indexes built from DB
let CURRENT_PARTY = null;
let PARTY_VALIDATED = false;

const OHKO_MOVES_KO = new Set(["절대냉동", "땅가르기", "가위자르기", "뿔드릴"]); // Sheer Cold, Fissure, Guillotine, Horn Drill

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

const types_ko_map = {
  "normal":"노말","fire":"불꽃","water":"물","electric":"전기","grass":"풀","ice":"얼음",
  "fighting":"격투","poison":"독","ground":"땅","flying":"비행","psychic":"에스퍼",
  "bug":"벌레","rock":"바위","ghost":"고스트","dragon":"드래곤","dark":"악","steel":"강철"
};

// 일부 아이템 효과(설명/완화 로직)
const ITEM_EFFECTS = {
  "먹다남은음식": { kind:"heal", note:"매 턴 HP 회복(지구력↑)" },
  "생명의구슬": { kind:"atk", note:"기술 위력↑(반동 있음) (추정 반영)" },
  // 상태 회복 열매
  "복숭열매": { kind:"status", cures:["독","맹독"], note:"독/맹독 1회 치료" },
  "리샘열매": { kind:"status", cures:["상태이상 전반"], note:"상태이상 1회 치료(범용)" },
  "초치열매": { kind:"status", cures:["잠듦"], note:"잠듦 1회 치료(추정)" },
  // 반감 열매(대표만)
  "슈캐열매": { kind:"resist", type:"땅", note:"땅 타입 공격 피해 1회 반감(추정)" },
  "야파열매": { kind:"resist", type:"얼음", note:"얼음 타입 공격 피해 1회 반감(추정)" },
  "초나열매": { kind:"resist", type:"불꽃", note:"불꽃 타입 공격 피해 1회 반감(추정)" },
  "린드열매": { kind:"resist", type:"풀", note:"풀 타입 공격 피해 1회 반감(추정)" },
  "마코열매": { kind:"resist", type:"전기", note:"전기 타입 공격 피해 1회 반감(추정)" },
  "요플열매": { kind:"resist", type:"격투", note:"격투 타입 공격 피해 1회 반감(추정)" },
  "하반열매": { kind:"resist", type:"드래곤", note:"드래곤 타입 공격 피해 1회 반감(추정)" },
  "바리비열매": { kind:"resist", type:"강철", note:"강철 타입 공격 피해 1회 반감(추정)" },
  "자보열매": { kind:"resist", type:"악", note:"악 타입 공격 피해 1회 반감(추정)" },
  "카시브열매": { kind:"resist", type:"고스트", note:"고스트 타입 공격 피해 1회 반감(추정)" },
};

function el(id){ return document.getElementById(id); }
function val(id){ return (el(id).value || "").trim(); }
function setVal(id, v){ el(id).value = v ?? ""; }

function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function norm(s){
  return (s ?? "").toString().trim().replace(/\s+/g,"");
}

function multAgainst(defTypes, atkType){
  let m = 1.0;
  for (const dt of defTypes){
    const row = TYPE_CHART[atkType] || {};
    m *= (row[dt] ?? 1.0);
  }
  return m;
}

// 라벨링(기준은 “체감용”)
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

// 게이지(시각화용)
function gaugeThreat(x){
  return clamp01((x - 0.5) / (3.0 - 0.5));
}
function gaugeFirepower(x){
  return clamp01((x - 0.6) / (2.8 - 0.6));
}
function barHtml(frac){
  const w = Math.round(clamp01(frac) * 100);
  return `<div class="bar"><div class="barFill" style="width:${w}%"></div></div>`;
}

function stabMultiplier(moveType, userTypes){
  return userTypes.includes(moveType) ? 1.5 : 1.0;
}

function powerWeight(power){
  const p = Number(power ?? 0);
  if (!p) return 0.6; // 변화기 등
  return Math.min(1.4, Math.max(0.4, 0.4 + p/150));
}

/* 아주 최소 추정(DB에 없을 때만 사용) */
function guessMoveTypeKo(nameKo){
  const map = {
    "파도타기":"물","냉동빔":"얼음","10만볼트":"전기","명상":"에스퍼","잠자기":"에스퍼",
    "지진":"땅","역린":"드래곤","불꽃엄니":"불꽃","맹독":"독",
    "코멧펀치":"강철","불릿펀치":"강철","칼춤":"노말","대폭발":"노말",
  };
  return map[nameKo] || null;
}
function guessMovePower(nameKo){
  const map = {
    "파도타기":95,"냉동빔":95,"10만볼트":95,"지진":100,"역린":120,"불꽃엄니":65,
    "코멧펀치":100,"불릿펀치":40,"대폭발":250
  };
  return map[nameKo] ?? null;
}

/* ---------- Levenshtein(오탈자 후보 제안용) ---------- */
function levenshtein(a,b){
  a = norm(a); b = norm(b);
  const n=a.length, m=b.length;
  if(!n) return m;
  if(!m) return n;
  const dp = Array.from({length:n+1}, ()=>Array(m+1).fill(0));
  for(let i=0;i<=n;i++) dp[i][0]=i;
  for(let j=0;j<=m;j++) dp[0][j]=j;
  for(let i=1;i<=n;i++){
    for(let j=1;j<=m;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      dp[i][j]=Math.min(
        dp[i-1][j]+1,
        dp[i][j-1]+1,
        dp[i-1][j-1]+cost
      );
    }
  }
  return dp[n][m];
}
function suggest(term, candidates, k=3){
  const t = norm(term);
  if(!t) return [];
  const scored = candidates.map(c=>({c, d:levenshtein(t,c)}));
  scored.sort((x,y)=>x.d-y.d);
  return scored.slice(0,k).map(x=>x.c);
}

/* ---------- DB load + index ---------- */
async function loadDb(path){
  const res = await fetch(path, {cache:"no-store"});
  if (!res.ok) throw new Error(`DB 로드 실패: ${res.status}`);
  DB = await res.json();
  IDX = buildIndexes(DB);
  fillTypeSelects();
  renderLists();
  renderOppList();
  renderActiveSelect();

  el("dbStatus").textContent = `DB 로드됨: ${DB?.meta?.name ?? "(unknown)"} / sets=${DB?.sets?.length ?? 0} / 포켓몬=${IDX.pokemonNames.length}`;
  el("recStatus").textContent = "";
  PARTY_VALIDATED = false;
  el("partyStatus").textContent = "검증 전";
}

function buildIndexes(db){
  const pokemonMap = new Map(); // ko -> types_ko
  const pokemonNames = new Set();
  const items = new Set();
  const moves = new Map(); // move_ko -> {type_ko,power,damage_class_ko}

  // meta.moveIndex_ko 우선
  const metaMove = db?.meta?.moveIndex_ko || {};
  for (const [k,v] of Object.entries(metaMove)){
    if (!k || k==="nan") continue;
    moves.set(k, {type_ko:v.type_ko, power:v.power ?? 0, damage_class_ko: null});
  }

  // sets에서 보강
  for (const s of (db.sets || [])){
    const p = (s.pokemon_ko ?? "").toString();
    if (p && p !== "nan"){
      pokemonNames.add(p);
      if (Array.isArray(s.types_ko) && s.types_ko.length){
        pokemonMap.set(p, s.types_ko);
      }
    }
    const it = (s.item_ko ?? "").toString();
    if (it && it !== "nan") items.add(it);

    for (const mv of (s.moves || [])){
      const mk = (mv.name_ko ?? "").toString();
      if (!mk || mk==="nan") continue;
      if (!moves.has(mk)){
        moves.set(mk, {
          type_ko: mv.type_ko ?? null,
          power: mv.power ?? 0,
          damage_class_ko: mv.damage_class_ko ?? mv.damage_class_ko ?? null
        });
      }
    }
  }

  const pokemonList = [...pokemonNames].sort((a,b)=>a.localeCompare(b,"ko"));
  const itemList = [...items].sort((a,b)=>a.localeCompare(b,"ko"));
  const moveList = [...moves.keys()].sort((a,b)=>a.localeCompare(b,"ko"));

  return {
    pokemonTypes: pokemonMap,
    pokemonNames: pokemonList,
    itemNames: itemList,
    moveIndex: moves,
    moveNames: moveList
  };
}

function renderLists(){
  // datalist: pokemon/move/item
  const dlP = el("pokemonList");
  dlP.innerHTML = "";
  for (const n of IDX.pokemonNames){
    const opt = document.createElement("option");
    opt.value = n;
    dlP.appendChild(opt);
  }

  const dlM = el("moveList");
  dlM.innerHTML = "";
  for (const n of IDX.moveNames){
    const opt = document.createElement("option");
    opt.value = n;
    dlM.appendChild(opt);
  }

  const dlI = el("itemList");
  dlI.innerHTML = "";
  // DB에 있는 아이템 + 효과사전에 있는 아이템도 같이 제안
  const merged = new Set([...IDX.itemNames, ...Object.keys(ITEM_EFFECTS)]);
  for (const n of [...merged].sort((a,b)=>a.localeCompare(b,"ko"))){
    const opt = document.createElement("option");
    opt.value = n;
    dlI.appendChild(opt);
  }
}

function renderOppList(){
  // pokemonList datalist와 동일 사용(별도 구성 불필요)
}

function fillTypeSelects(){
  for (const i of [1,2,3]){
    fillTypeSelect(`m${i}_t1`, false);
    fillTypeSelect(`m${i}_t2`, true);
  }
}
function fillTypeSelect(id, allowEmpty){
  const s = el(id);
  s.innerHTML = "";
  if (allowEmpty){
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "(없음)";
    s.appendChild(opt0);
  }
  for (const t of TYPE_LIST){
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    s.appendChild(opt);
  }
}

/* ---------- Party book (multi-save) ---------- */
function loadBook(){
  try{
    return JSON.parse(localStorage.getItem(LS_BOOK_KEY) || "{}");
  }catch{
    return {};
  }
}
function saveBook(book){
  localStorage.setItem(LS_BOOK_KEY, JSON.stringify(book));
}
function setLastPartyName(name){
  localStorage.setItem(LS_LAST_KEY, name || "");
}
function getLastPartyName(){
  return localStorage.getItem(LS_LAST_KEY) || "";
}

function abbrKo(name){
  const s = (name || "").trim();
  if (s.length <= 2) return s;
  return s.slice(0,2);
}
function autoPartyNameFromUI(){
  const a = abbrKo(val("m1_name"));
  const b = abbrKo(val("m2_name"));
  const c = abbrKo(val("m3_name"));
  const base = [a,b,c].filter(Boolean).join("-");
  return base || "내파티";
}
function refreshPartySelect(){
  const book = loadBook();
  const sel = el("partySelect");
  sel.innerHTML = "";
  const names = Object.keys(book).sort((a,b)=>a.localeCompare(b,"ko"));
  for (const nm of names){
    const opt = document.createElement("option");
    opt.value = nm;
    opt.textContent = nm;
    sel.appendChild(opt);
  }
  const last = getLastPartyName();
  if (last && book[last]){
    sel.value = last;
  }else if (names.length){
    sel.value = names[0];
  }
}

/* ---------- Validation UI helpers ---------- */
function setFieldState(inputId, state, helpMsg){
  const inp = el(inputId);
  const help = el(`${inputId}_help`);
  inp.classList.remove("invalid","warning");
  if (state === "err") inp.classList.add("invalid");
  if (state === "warn") inp.classList.add("warning");
  if (help) help.textContent = helpMsg || "";
}

function setPartyStatus(ok, msg){
  const s = el("partyStatus");
  s.textContent = msg;
  s.style.color = ok ? "var(--ok)" : "var(--danger)";
}

/* ---------- Build party object from UI ---------- */
function readMember(i){
  const name = val(`m${i}_name`);
  const item = val(`m${i}_item`);
  const t1 = val(`m${i}_t1`);
  const t2 = val(`m${i}_t2`);
  const types = [t1, t2].filter(Boolean);
  const moves = [1,2,3,4].map(k=>val(`m${i}_mv${k}`)).filter(Boolean);
  return { name_ko:name, item_ko:item, types_ko:types, moves: moves.map(x=>({name_ko:x})) };
}
function buildPartyFromUI(){
  const m1 = readMember(1);
  const m2 = readMember(2);
  const m3 = readMember(3);
  return { members:[m1,m2,m3] };
}

function renderActiveSelect(){
  const sel = el("activeSelect");
  sel.innerHTML = "";
  const names = [
    val("m1_name") || "1번",
    val("m2_name") || "2번",
    val("m3_name") || "3번"
  ];
  for (let i=0;i<3;i++){
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${i+1}) ${names[i]}`;
    sel.appendChild(opt);
  }
}

/* 자동 타입 세팅: DB에 포켓몬 있으면 타입 고정, 없으면 수동 선택 유지 */
function autoFillTypesIfKnown(i){
  const name = val(`m${i}_name`);
  const knownTypes = IDX?.pokemonTypes?.get(name);
  const t1 = el(`m${i}_t1`);
  const t2 = el(`m${i}_t2`);
  if (knownTypes && knownTypes.length){
    t1.value = knownTypes[0] || "";
    t2.value = knownTypes[1] || "";
  }
}

/* ---------- Party validation ---------- */
function validateParty(){
  if (!DB || !IDX){
    setPartyStatus(false, "DB를 먼저 로드하세요.");
    PARTY_VALIDATED = false;
    return {ok:false};
  }

  let errCount = 0;
  let warnCount = 0;

  for (const i of [1,2,3]){
    // Pokemon
    const p = val(`m${i}_name`);
    if (!p){
      setFieldState(`m${i}_name`, "err", "포켓몬 이름이 비었습니다.");
      errCount++;
    } else if (!IDX.pokemonTypes.has(p)){
      // DB에 타입이 없는(=DB에 없거나 이상) 경우
      const s = suggest(p, IDX.pokemonNames);
      setFieldState(`m${i}_name`, "err", `DB에서 찾지 못함 ❗ (추천: ${s.join(", ") || "없음"})`);
      errCount++;
    } else {
      setFieldState(`m${i}_name`, "ok", `DB 확인됨 ✅ (타입 자동 적용)`);
      autoFillTypesIfKnown(i);
    }

    // Types
    const t1 = val(`m${i}_t1`);
    if (!t1){
      setFieldState(`m${i}_t1`, "err", "타입1은 필수입니다.");
      errCount++;
    } else {
      setFieldState(`m${i}_t1`, "ok", "");
    }
    setFieldState(`m${i}_t2`, "ok", ""); // 선택

    // Item
    const it = val(`m${i}_item`);
    if (!it){
      setFieldState(`m${i}_item`, "warn", "지닌물건이 비었습니다(없어도 가능).");
      warnCount++;
    } else {
      const hasInDb = IDX.itemNames.includes(it);
      const hasInFx = !!ITEM_EFFECTS[it];
      if (!hasInDb && !hasInFx){
        const s = suggest(it, [...IDX.itemNames, ...Object.keys(ITEM_EFFECTS)]);
        setFieldState(`m${i}_item`, "warn", `DB/사전에 없음(정확도↓) ⚠️ (추천: ${s.join(", ") || "없음"})`);
        warnCount++;
      } else {
        const note = ITEM_EFFECTS[it]?.note;
        setFieldState(`m${i}_item`, "ok", note ? `✅ ${note}` : "DB 확인됨 ✅");
      }
    }

    // Moves
    for (const k of [1,2,3,4]){
      const mv = val(`m${i}_mv${k}`);
      if (!mv){
        setFieldState(`m${i}_mv${k}`, "warn", "기술이 비었습니다(4개 모두 입력 권장).");
        warnCount++;
        continue;
      }
      if (IDX.moveIndex.has(mv)){
        setFieldState(`m${i}_mv${k}`, "ok", "DB 확인됨 ✅");
      } else {
        const gT = guessMoveTypeKo(mv);
        const gP = guessMovePower(mv);
        const s = suggest(mv, IDX.moveNames);
        if (gT || gP){
          setFieldState(`m${i}_mv${k}`, "warn", `DB에 없음(추정치 사용) ⚠️ (추천: ${s.join(", ") || "없음"})`);
          warnCount++;
        } else {
          setFieldState(`m${i}_mv${k}`, "err", `DB에서 찾지 못함 ❗ (추천: ${s.join(", ") || "없음"})`);
          errCount++;
        }
      }
    }
  }

  // party name auto fill
  const autoName = autoPartyNameFromUI();
  if (!val("partyName")) setVal("partyName", autoName);
  el("partyNameHelp").textContent = `자동 제안: ${autoName}`;

  renderActiveSelect();

  if (errCount === 0){
    PARTY_VALIDATED = true;
    CURRENT_PARTY = buildPartyFromUI();
    setPartyStatus(true, warnCount ? `파티 사용가능! (경고 ${warnCount}개: 일부는 추정치 사용)` : "파티 사용가능!");
    return {ok:true, warnCount};
  } else {
    PARTY_VALIDATED = false;
    CURRENT_PARTY = null;
    setPartyStatus(false, `오류 ${errCount}개로 파티 사용 불가(빨간 표시 확인).`);
    return {ok:false, errCount, warnCount};
  }
}

/* ---------- Save/Load/Delete party ---------- */
function savePartyToBook(){
  const v = validateParty(); // 저장 시에도 검증
  if (!v.ok){
    alert("파티 검증을 통과해야 저장할 수 있습니다.");
    return;
  }
  const name = (val("partyName") || autoPartyNameFromUI()).trim();
  const party = buildPartyFromUI();
  const book = loadBook();
  book[name] = party;
  saveBook(book);
  setLastPartyName(name);
  refreshPartySelect();
  el("partyStatus").textContent = `저장 완료: ${name}`;
}

function loadPartyFromBook(){
  const book = loadBook();
  const name = el("partySelect").value;
  const party = book[name];
  if (!party){
    alert("선택된 파티가 없습니다.");
    return;
  }
  setLastPartyName(name);
  setVal("partyName", name);

  // write members
  for (let i=1;i<=3;i++){
    const m = party.members[i-1] || {};
    setVal(`m${i}_name`, m.name_ko || "");
    setVal(`m${i}_item`, m.item_ko || "");
    // types
    const t = m.types_ko || [];
    el(`m${i}_t1`).value = t[0] || "";
    el(`m${i}_t2`).value = t[1] || "";
    // moves
    const mv = (m.moves || []).map(x=>x.name_ko);
    for (let k=1;k<=4;k++){
      setVal(`m${i}_mv${k}`, mv[k-1] || "");
    }
  }
  renderActiveSelect();
  PARTY_VALIDATED = false;
  el("partyStatus").textContent = "불러오기 완료(검증 필요)";
}

function deletePartyFromBook(){
  const name = el("partySelect").value;
  if (!name) return;
  const ok = confirm(`'${name}' 파티를 삭제할까요?`);
  if (!ok) return;
  const book = loadBook();
  delete book[name];
  saveBook(book);
  if (getLastPartyName() === name) setLastPartyName("");
  refreshPartySelect();
  el("partyStatus").textContent = "삭제 완료";
}

/* ---------- Recommendation engine ---------- */
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

function decorateMyMoves(myMember){
  const moves = myMember.moves.map(m => {
    const name = m.name_ko;
    const idx = IDX.moveIndex.get(name);
    const out = {...m};
    if (idx){
      out.type_ko = idx.type_ko;
      out.power = idx.power ?? 0;
    }else{
      out.type_ko = guessMoveTypeKo(name) || "노말";
      out.power = guessMovePower(name) || 0;
    }
    return out;
  });
  return {...myMember, moves};
}

function itemAtkMultiplier(itemKo){
  if (itemKo === "생명의구슬") return 1.3; // 추정
  return 1.0;
}
function berryResistApplies(myItem, atkType){
  const fx = ITEM_EFFECTS[myItem];
  if (!fx) return false;
  return fx.kind === "resist" && fx.type === atkType;
}

function threatScoreOpponentToMe(oppSet, myMember){
  let best = 0;
  const myItem = myMember.item_ko || "";

  for (const mv of (oppSet.moves || [])){
    const mvName = mv.name_ko || "";

    if (OHKO_MOVES_KO.has(mvName)){
      best = Math.max(best, 2.5);
      continue;
    }

    const atkType = mv.type_ko || "노말";
    let eff = multAgainst(myMember.types_ko, atkType);

    // 반감열매(1회) 보수 반영: “최대 위협도”를 약간 낮춰서 설명에 반영
    if (berryResistApplies(myItem, atkType)){
      eff *= 0.65; // 0.5면 과감하니 보수적으로 0.65
    }

    const stab = stabMultiplier(atkType, oppSet.types_ko || []);
    const pw = powerWeight(mv.power);

    let statusB = 1.0;
    if ((mv.damage_class_ko || mv.damage_class_ko || "") === "변화" && mvName){
      const isKey = ["맹독","독","전기자석파","최면술","도발","앙코르"].includes(mvName);
      statusB = isKey ? 1.25 : 1.05;

      // 리샘/복숭 등 상태 회복열매가 있으면 상태 위협을 조금 낮게
      const fx = ITEM_EFFECTS[myItem];
      if (fx && fx.kind === "status"){
        statusB *= 0.85;
      }
    }

    const score = eff * stab * pw * statusB;
    best = Math.max(best, score);
  }

  return best;
}

function bestMoveMeToOpponent(myMemberDecorated, oppTypes){
  let best = {name:null, score:0, eff:1, stab:1, type:"노말"};
  for (const mv of myMemberDecorated.moves){
    const atkType = mv.type_ko || "노말";
    const eff = multAgainst(oppTypes, atkType);
    const stab = stabMultiplier(atkType, myMemberDecorated.types_ko);
    const pw = powerWeight(mv.power);
    const score = eff * stab * pw;
    if (score > best.score){
      best = {name: mv.name_ko, score, eff, stab, type: atkType, power: mv.power || 0};
    }
  }
  // 공격 보정(생구 등)
  best.score *= itemAtkMultiplier(myMemberDecorated.item_ko);
  return best;
}

function recommend(activeIndex, oppNameKo, itemObs, moveObs){
  if (!DB || !IDX) return { ok:false, msg:"DB가 로드되지 않았습니다." };
  if (!PARTY_VALIDATED || !CURRENT_PARTY) return { ok:false, msg:"파티 검증이 필요합니다. '파티 입력완료(검증)'를 먼저 누르세요." };

  const party = CURRENT_PARTY.members.map(m => decorateMyMoves(m));
  const active = party[activeIndex];

  const allOpp = DB.sets.filter(s => s.pokemon_ko === oppNameKo);
  if (!allOpp.length) return { ok:false, msg:`DB에서 '${oppNameKo}'를 찾지 못했습니다.` };

  const cand = filterSetsByObservation(allOpp, itemObs, moveObs);
  const candSets = cand.length ? cand : allOpp;

  const oppTypes = candSets[0].types_ko || [];

  // 현재 선봉: 위협/내 최적기술
  const myBestMove = bestMoveMeToOpponent(active, oppTypes);
  const meAtk = myBestMove.score;
  const meThreat = Math.max(...candSets.map(s => threatScoreOpponentToMe(s, active)));

  // 랭크업 가능 체크
  const hasSetup = active.moves.some(m => ["명상","칼춤"].includes(m.name_ko));
  const setupOk = hasSetup && meThreat < 1.05 && meAtk < 1.15;

  // 교체 후보
  const candidates = [
    {idx:0, label:`${party[0].name_ko}(유지)`, member:party[0]},
    {idx:1, label:`${party[1].name_ko}(교체)`, member:party[1]},
    {idx:2, label:`${party[2].name_ko}(교체)`, member:party[2]},
  ].filter(x => x.member && x.member.name_ko);

  const actions = [];

  // 1) 바로 공격
  actions.push({
    action: "바로 공격",
    detail: `추천 기술: ${myBestMove.name || "알 수 없습니다"}`,
    score: (meAtk - meThreat),
    meta: {move: myBestMove, threat: meThreat, atk: meAtk}
  });

  // 2) 랭크업
  actions.push({
    action: "랭크업(명상/칼춤)",
    detail: setupOk ? "조건 충족: 위협 낮고 즉시 화력이 낮음" : "비추천(위협이 있거나 즉시 화력이 충분)",
    score: (setupOk ? (meAtk + 0.25) : -999) - (meThreat + 0.25),
    meta: {threat: meThreat, atk: meAtk}
  });

  // 3) 교체
  for (const c of candidates){
    if (c.idx === activeIndex) continue;
    const bm = bestMoveMeToOpponent(c.member, oppTypes);
    const atk = bm.score;
    const thr = Math.max(...candSets.map(s => threatScoreOpponentToMe(s, c.member)));
    const safeBonus = (1.0 - thr);
    actions.push({
      action: `${c.member.name_ko}로 교체`,
      detail: `교체 후 추천 기술: ${bm.name || "알 수 없습니다"}`,
      score: (atk - thr) + safeBonus,
      meta: {move: bm, threat: thr, atk}
    });
  }

  actions.sort((a,b)=>b.score-a.score);
  const best = actions[0];

  const why = [];

  // 핵심 출력: 이해 쉬운 형태
  why.push({kind:"text", value:`후보 세트: ${candSets.length}개 (관측 필터 ${cand.length ? "적용" : "미적용"})`});

  why.push({kind:"text", value:`상대의 최대 위협도(현재 선봉 기준): ${meThreat.toFixed(2)} (${labelThreat(meThreat)})`});
  why.push({kind:"html", value:barHtml(gaugeThreat(meThreat))});

  why.push({kind:"text", value:`내 즉시 화력(현재 선봉 기준): ${meAtk.toFixed(2)} (${labelFirepower(meAtk)})`});
  why.push({kind:"html", value:barHtml(gaugeFirepower(meAtk))});

  // 아이템 설명
  const it = active.item_ko || "";
  if (it && ITEM_EFFECTS[it]){
    why.push({kind:"text", value:`내 아이템 메모: ${it} — ${ITEM_EFFECTS[it].note}`});
  }

  // 추천 기술 표시(바로 공격/교체 모두)
  if (best.meta?.move?.name){
    const mv = best.meta.move;
    const effTxt = mv.eff >= 2 ? "효과 굉장함" : (mv.eff <= 0.5 ? "효과 별로" : "보통");
    const stabTxt = mv.stab >= 1.5 ? "STAB" : "비STAB";
    why.push({kind:"text", value:`추천 기술: ${mv.name} (타입:${mv.type}, 위력:${mv.power || 0}, ${effTxt}, ${stabTxt})`});
  }

  // 주의 기술(상대)
  const threatMoves = summarizeThreatMoves(candSets, active);
  if (threatMoves.length){
    why.push({kind:"text", value:`주의 기술(후보 기준): ${threatMoves.join(", ")}`});
  }

  // 점수 설명(고급)
  const advanced = [];
  advanced.push(`(고급) 추천 지수는 ‘내 화력 - 상대 위협 + 안전보정(교체)’ 형태의 휴리스틱입니다. 확률이 아닙니다.`);
  advanced.push(`(고급) 2~4위 행동도 같은 기준으로 상대 비교합니다(값이 높을수록 추천).`);

  return { ok:true, best, actions, why, advanced };
}

function summarizeThreatMoves(candSets, myMember){
  const freq = new Map();
  for (const s of candSets){
    for (const mv of (s.moves || [])){
      const name = mv.name_ko || "";
      const type = mv.type_ko || "노말";
      const eff = multAgainst(myMember.types_ko, type);
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

/* ---------- Render result (HTML 깨짐 해결) ---------- */
function escapeHtml(s){
  return (s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}

function renderResult(rec){
  const box = el("resultBox");
  if (!rec.ok){
    box.innerHTML = `<h3>오류</h3><div class="mono">${escapeHtml(rec.msg)}</div>`;
    return;
  }

  const lines = [];
  lines.push(`<h3>추천: ${escapeHtml(rec.best.action)}</h3>`);
  if (rec.best.detail){
    lines.push(`<div class="small">${escapeHtml(rec.best.detail)}</div>`);
  }
  lines.push("<hr class='sep'/>");

  lines.push("<ul class='ulClean liGap'>");
  for (const w of rec.why){
    if (w.kind === "html"){
      lines.push(`<li>${w.value}</li>`);
    } else {
      lines.push(`<li>${escapeHtml(w.value)}</li>`);
    }
  }
  lines.push("</ul>");

  // 후보 행동은 "고급"으로 접기
  lines.push("<details class='details mt'><summary>고급: 행동 후보 순위/지수 보기</summary>");
  lines.push("<div class='small mt'>");
  lines.push(`<div>${escapeHtml(rec.advanced[0])}</div>`);
  lines.push(`<div>${escapeHtml(rec.advanced[1])}</div>`);
  lines.push("<hr class='sep'/>");
  lines.push("<ol class='ulClean liGap'>");
  for (const a of rec.actions){
    lines.push(`<li>${escapeHtml(a.action)} — 지수 ${a.score.toFixed(2)} / ${escapeHtml(a.detail || "")}</li>`);
  }
  lines.push("</ol></div></details>");

  box.innerHTML = lines.join("\n");
}

/* ---------- init defaults ---------- */
function initDefaults(){
  // 기본값(원하면 삭제/수정)
  setVal("m1_name","스이쿤");
  setVal("m1_item","먹다남은음식");
  setVal("m1_mv1","파도타기");
  setVal("m1_mv2","냉동빔");
  setVal("m1_mv3","10만볼트");
  setVal("m1_mv4","잠자기");

  setVal("m2_name","한카리아스");
  setVal("m2_item","리샘열매");
  setVal("m2_mv1","지진");
  setVal("m2_mv2","역린");
  setVal("m2_mv3","맹독");
  setVal("m2_mv4","불꽃엄니");

  setVal("m3_name","메타그로스");
  setVal("m3_item","생명의구슬");
  setVal("m3_mv1","칼춤");
  setVal("m3_mv2","불릿펀치");
  setVal("m3_mv3","코멧펀치");
  setVal("m3_mv4","대폭발");

  setVal("partyName", autoPartyNameFromUI());
}

/* ---------- main wiring ---------- */
window.addEventListener("load", () => {
  fillTypeSelects();
  initDefaults();
  refreshPartySelect();
  renderActiveSelect();

  // name change -> active select refresh
  for (const i of [1,2,3]){
    el(`m${i}_name`).addEventListener("input", () => {
      if (IDX) autoFillTypesIfKnown(i);
      setVal("partyName", autoPartyNameFromUI());
      renderActiveSelect();
      PARTY_VALIDATED = false;
      el("partyStatus").textContent = "검증 전";
    });
  }

  el("btnLoadDb").addEventListener("click", async () => {
    try {
      await loadDb(el("dbSelect").value);
    } catch (e) {
      el("dbStatus").textContent = `DB 로드 실패: ${e.message}`;
    }
  });

  el("btnValidateParty").addEventListener("click", () => {
    validateParty();
  });

  el("btnSaveParty").addEventListener("click", () => {
    savePartyToBook();
  });

  el("btnLoadParty").addEventListener("click", () => {
    loadPartyFromBook();
  });

  el("btnDeleteParty").addEventListener("click", () => {
    deletePartyFromBook();
  });

  el("partySelect").addEventListener("change", () => {
    const name = el("partySelect").value;
    if (name) setLastPartyName(name);
  });

  el("btnRecommend").addEventListener("click", () => {
    el("recStatus").textContent = "";
    const opp = val("oppName");
    if (!opp){
      renderResult({ok:false, msg:"상대 포켓몬을 입력하세요."});
      return;
    }
    if (!PARTY_VALIDATED){
      renderResult({ok:false, msg:"파티 검증이 필요합니다. '파티 입력완료(검증)'를 먼저 누르세요."});
      return;
    }
    const activeIndex = Number(el("activeSelect").value || "0");
    const itemObs = val("oppItemObs");
    const moveObs = val("oppMoveObs");
    const rec = recommend(activeIndex, opp, itemObs, moveObs);
    renderResult(rec);
  });

  // PWA 서비스워커(있으면)
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
  }
});

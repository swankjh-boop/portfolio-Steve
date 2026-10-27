// ===== Supabase 연결 정보 (공개 키라서 파일에 넣어도 괜찮다) =====
const SUPABASE_URL = "https://fbrtfbmrbbwdgtodqzit.supabase.co";
const SUPABASE_KEY = "sb_publishable_Xr7lz86qN3uKfgTDtB5peg_ua2KZkPK";

// Supabase 표에 요청을 보내는 함수
async function api(path, options = {}) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return res;
}

// ===== 브라우저에 저장하는 값 (좋아요를 누른 카드 기억용) =====
function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 저장이 막힌 브라우저(비공개 창 등)에서는 그냥 넘어간다
  }
}

// 이 브라우저만의 번호. 처음 한 번 만들고 계속 같은 번호를 쓴다
function getClientId() {
  let id = readStore("resume_client_id", null);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    writeStore("resume_client_id", id);
  }
  return id;
}

const clientId = getClientId();
const likedIds = new Set(readStore("resume_liked", []));

// ===== 작은 도우미 =====
function $(id) {
  return document.getElementById(id);
}

// 태그를 만들고 글자를 넣는다 (글자는 항상 textContent로 넣어 안전하게)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// http/https 주소만 연다
function isWebUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.3 3.2 4.5 7 4.5c2.1 0 3.6 1.1 5 2.9 1.4-1.8 2.9-2.9 5-2.9 3.8 0 6 3.8 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>';

// ===== 1. 프로필 =====
async function loadProfile() {
  try {
    const res = await api("profile?id=eq.1&select=*");
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    const p = rows[0];
    if (!p) {
      $("name").textContent = "프로필이 아직 없어요";
      return;
    }
    showProfile(p);
  } catch (e) {
    $("name").textContent = "프로필을 불러오지 못했어요";
  }
}

function showProfile(p) {
  document.title = p.name ? p.name + " | 포트폴리오" : "포트폴리오";

  // 사진 (없으면 회색 자리 그대로)
  const photo = $("photo");
  photo.textContent = "";
  if (isWebUrl(p.photo_url)) {
    const img = el("img");
    img.src = p.photo_url;
    img.alt = p.name + " 프로필 사진";
    photo.appendChild(img);
  }

  $("name").textContent = p.name;
  $("job").textContent = p.title;

  const badge = $("badge");
  badge.textContent = p.career_badge;
  badge.hidden = !p.career_badge;

  $("c-name").textContent = p.name;
  $("c-email").textContent = p.email;
  $("c-phone").textContent = p.phone;
  $("c-location").textContent = p.location;

  // 한 줄 소개: 이름이 들어 있으면 그 부분에 파란 밑줄
  const headline = $("headline");
  headline.textContent = "";
  const text = p.headline || "";
  if (p.name && text.includes(p.name)) {
    const parts = text.split(p.name);
    parts.forEach((part, i) => {
      headline.appendChild(document.createTextNode(part));
      if (i < parts.length - 1) headline.appendChild(el("span", "hl", p.name));
    });
  } else {
    headline.textContent = text;
  }

  $("intro").textContent = p.intro;
  $("education").textContent = p.education;
  $("skills").textContent = p.skills;
  $("experience").textContent = p.experience;

  const quote = $("quote");
  quote.textContent = p.quote ? "“" + p.quote + "”" : "";
  quote.hidden = !p.quote;
}

// ===== 2. 포트폴리오 카드 =====
async function loadProjects() {
  const box = $("cards");
  try {
    const res = await api("projects?select=*&order=sort_order.asc,id.asc");
    if (!res.ok) throw new Error(res.status);
    const projects = await res.json();

    box.textContent = "";
    if (projects.length === 0) {
      box.appendChild(el("p", "empty", "아직 등록된 프로젝트가 없어요."));
      return;
    }
    projects.forEach((project) => box.appendChild(makeCard(project)));
  } catch (e) {
    box.textContent = "";
    box.appendChild(el("p", "empty", "프로젝트를 불러오지 못했어요. 잠시 후 새로고침해 주세요."));
  }
}

function makeCard(project) {
  const card = el("article", "card");

  // 누르는 부분: 썸네일 + 글
  const open = el("button", "card-open");
  open.type = "button";
  const link = isWebUrl(project.file_url) ? project.file_url
    : isWebUrl(project.thumbnail_url) ? project.thumbnail_url
    : null;
  if (link) {
    open.addEventListener("click", () => {
      window.open(link, "_blank", "noopener");
    });
    open.title = "새 탭에서 열기";
  } else {
    open.disabled = true;
  }

  // 브라우저 창 모양 썸네일
  const thumb = el("span", "thumb");
  const bar = el("span", "thumb-bar");
  bar.append(el("i"), el("i"), el("i"));
  const imgBox = el("span", "thumb-img");
  if (isWebUrl(project.thumbnail_url)) {
    const img = el("img");
    img.src = project.thumbnail_url;
    img.alt = project.title + " 썸네일";
    img.loading = "lazy";
    imgBox.appendChild(img);
  }
  thumb.append(bar, imgBox);

  // 글
  const body = el("span", "card-body");
  const meta = [project.number, project.category].filter(Boolean).join(" · ");
  body.appendChild(el("span", "card-meta", meta));
  body.appendChild(el("span", "card-title", project.title));
  body.appendChild(el("span", "card-desc", project.description));

  const tags = el("span", "card-tags");
  (project.tags || []).forEach((t) => tags.appendChild(el("span", "tag", t)));
  body.appendChild(tags);

  open.append(thumb, body);

  // 하트 좋아요 버튼
  const like = el("button", "like");
  like.type = "button";
  like.innerHTML = HEART_SVG;
  const count = el("span", "like-count", "0");
  like.appendChild(count);
  setLiked(like, likedIds.has(project.id));
  like.addEventListener("click", () => sendLike(project.id, like, count));

  card.append(open, like);

  loadLikeCount(project.id, count);
  return card;
}

function setLiked(button, liked) {
  button.classList.toggle("liked", liked);
  button.setAttribute("aria-pressed", liked ? "true" : "false");
  button.setAttribute("aria-label", liked ? "좋아요를 눌렀어요" : "좋아요");
}

// 카드 하나의 좋아요 수 세기
async function loadLikeCount(projectId, countNode) {
  try {
    const res = await api("likes?select=id&project_id=eq." + projectId, {
      method: "HEAD",
      headers: { Prefer: "count=exact" },
    });
    // 답 머리글에 "0-4/5" 처럼 오는데, / 뒤가 전체 개수다
    const range = res.headers.get("content-range") || "";
    const total = parseInt(range.split("/")[1], 10);
    countNode.textContent = Number.isNaN(total) ? "0" : String(total);
  } catch (e) {
    // 숫자를 못 읽으면 0으로 둔다
  }
}

async function sendLike(projectId, button, countNode) {
  if (likedIds.has(projectId) || button.disabled) return;
  button.disabled = true;

  try {
    const res = await api("likes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: { project_id: projectId, client_id: clientId },
    });

    if (res.ok) {
      countNode.textContent = String((parseInt(countNode.textContent, 10) || 0) + 1);
    } else if (res.status !== 409) {
      // 409는 "이미 누른 카드"라는 뜻이라 눌린 것으로 표시만 한다
      throw new Error(res.status);
    }

    likedIds.add(projectId);
    writeStore("resume_liked", Array.from(likedIds));
    setLiked(button, true);
  } catch (e) {
    alert("좋아요를 저장하지 못했어요. 잠시 후 다시 눌러 주세요.");
  } finally {
    button.disabled = false;
  }
}

// ===== 3. 방명록 =====
async function loadGuestbook() {
  const list = $("gb-list");
  try {
    const res = await api("resume_guestbook?select=*&order=created_at.desc&limit=100");
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();

    list.textContent = "";
    if (rows.length === 0) {
      list.appendChild(el("li", "empty", "아직 남긴 글이 없어요. 첫 번째로 남겨 주세요."));
      return;
    }
    rows.forEach((row) => list.appendChild(makeGuestItem(row)));
  } catch (e) {
    list.textContent = "";
    list.appendChild(el("li", "empty", "방명록을 불러오지 못했어요."));
  }
}

function makeGuestItem(row) {
  const li = el("li");
  const head = el("div", "gb-head");
  head.append(el("span", "gb-nick", row.nickname), el("span", "gb-date", formatDate(row.created_at)));
  li.append(head, el("p", "gb-msg", row.message));
  return li;
}

async function sendGuestbook() {
  const nickInput = $("gb-nickname");
  const msgInput = $("gb-message");
  const status = $("gb-status");
  const button = $("gb-submit");

  const nickname = nickInput.value.trim();
  const message = msgInput.value.trim();

  if (!nickname || !message) {
    status.textContent = "별명과 한마디를 모두 적어 주세요.";
    return;
  }

  button.disabled = true;
  status.textContent = "";

  try {
    const res = await api("resume_guestbook", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: { nickname, message },
    });
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();

    // 목록 맨 위에 새 글 붙이기
    const list = $("gb-list");
    const empty = list.querySelector(".empty");
    if (empty) empty.remove();
    list.prepend(makeGuestItem(rows[0]));

    msgInput.value = "";
  } catch (e) {
    status.textContent = "글을 남기지 못했어요. 잠시 후 다시 시도해 주세요.";
  } finally {
    button.disabled = false;
  }
}

$("gb-submit").addEventListener("click", sendGuestbook);

// 한마디 칸에서 Enter를 눌러도 남기기
$("gb-message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) sendGuestbook();
});

// ===== 시작 =====
loadProfile();
loadProjects();
loadGuestbook();

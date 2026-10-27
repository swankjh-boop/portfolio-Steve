// ===== Supabase 연결 정보 (공개 키라서 파일에 넣어도 괜찮다) =====
const SUPABASE_URL = "https://fbrtfbmrbbwdgtodqzit.supabase.co";
const SUPABASE_KEY = "sb_publishable_Xr7lz86qN3uKfgTDtB5peg_ua2KZkPK";
const BUCKET = "resume";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const FILE_TYPES = { ...IMAGE_TYPES, "application/pdf": "pdf" };

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

function isWebUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// 안내 문구 보여 주기 (kind: "ok" 또는 "error")
function showMsg(id, text, kind) {
  const node = $(id);
  node.textContent = text || "";
  node.className = "msg" + (kind ? " " + kind : "");
}

// ===== 로그인 정보 저장 (새로고침해도 로그인 유지) =====
const SESSION_KEY = "resume_admin_session";
let session = null;

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user,
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    // 저장이 막힌 브라우저에서는 이 탭에서만 로그인 유지
  }
}

function loadSession() {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  session = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    // 넘어감
  }
}

// ===== Supabase Auth (로그인) =====
async function authRequest(path, body) {
  const res = await fetch(SUPABASE_URL + "/auth/v1/" + path, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || String(res.status));
  return data;
}

// 토큰이 1분 안에 끝나면 새 토큰으로 바꾼다
async function freshToken() {
  if (!session) throw new Error("로그인이 필요해요");
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - 60 < now) {
    try {
      const data = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      saveSession(data);
    } catch (e) {
      clearSession();
      showView("login");
      showMsg("login-msg", "로그인 시간이 끝났어요. 다시 로그인해 주세요.", "error");
      throw e;
    }
  }
  return session.access_token;
}

// 로그인한 사람의 토큰을 붙여 Supabase에 요청한다
async function request(url, options = {}) {
  const token = await freshToken();
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + token,
      ...(options.headers || {}),
    },
    body: options.body,
  });
  if (res.status === 401) {
    clearSession();
    showView("login");
    showMsg("login-msg", "다시 로그인해 주세요.", "error");
  }
  return res;
}

// 표(REST)에 요청하고 결과를 돌려준다. 실패하면 오류를 던진다
async function db(path, options = {}) {
  const res = await request(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      // 바뀐 줄을 돌려받아서, 규칙에 막혀 아무것도 안 바뀌었는지 확인한다
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || String(res.status));
  }
  if (res.status === 204 || options.method === "HEAD") return res;
  return res.json();
}

// 바꾸거나 지운 줄이 하나도 없으면 권한이 없는 것
function mustChange(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("바뀐 내용이 없어요. 관리자 권한을 확인해 주세요.");
  }
  return rows;
}

// ===== 파일 올리기 =====
// 맞는 파일인지 확인. 문제가 있으면 안내 문구를, 괜찮으면 빈 글자를 돌려준다
function checkFile(file, allowed) {
  if (!file) return "";
  if (!allowed[file.type]) {
    return allowed === IMAGE_TYPES
      ? "이미지 파일(png, jpg, webp, gif)만 올릴 수 있어요."
      : "이미지(png, jpg, webp, gif) 또는 PDF만 올릴 수 있어요.";
  }
  if (file.size > MAX_SIZE) return "파일이 10MB보다 커요. 더 작은 파일을 골라 주세요.";
  return "";
}

// 영어·숫자로 새 이름을 지어 올리고, 공개 주소를 돌려준다
async function uploadFile(file, folder) {
  const random = Math.random().toString(36).slice(2, 8);
  const path = folder + "/" + Date.now() + "-" + random + "." + FILE_TYPES[file.type];
  const res = await request(SUPABASE_URL + "/storage/v1/object/" + BUCKET + "/" + path, {
    method: "POST",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error("파일을 올리지 못했어요. " + (data.message || data.error || res.status));
  }
  return SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" + path;
}

// ===== 화면 바꾸기 =====
function showView(name) {
  $("login-view").hidden = name !== "login";
  $("denied-view").hidden = name !== "denied";
  $("admin-view").hidden = name !== "admin";
}

// 로그인한 사람이 admins 표에 있는지 확인
async function checkAdmin() {
  const rows = await db("admins?select=user_id&user_id=eq." + encodeURIComponent(session.user.id));
  return rows.length > 0;
}

async function startAdmin() {
  try {
    if (!(await checkAdmin())) {
      showView("denied");
      return;
    }
  } catch (e) {
    if (session) {
      showView("login");
      showMsg("login-msg", "관리자인지 확인하지 못했어요. 다시 로그인해 주세요.", "error");
    }
    return;
  }
  showView("admin");
  $("who").textContent = session.user.email + " 로그인 중";
  loadProfile();
  loadProjects();
  loadGuestbook();
}

// ===== 로그인 · 로그아웃 =====
async function login() {
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    showMsg("login-msg", "이메일과 비밀번호를 모두 적어 주세요.", "error");
    return;
  }

  const button = $("login-button");
  button.disabled = true;
  showMsg("login-msg", "로그인 중...");
  try {
    const data = await authRequest("token?grant_type=password", { email, password });
    saveSession(data);
    $("login-password").value = "";
    showMsg("login-msg", "");
    await startAdmin();
  } catch (e) {
    showMsg("login-msg", "로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.", "error");
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  if (session) {
    try {
      await fetch(SUPABASE_URL + "/auth/v1/logout", {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token },
      });
    } catch (e) {
      // 서버에 못 알려도 이 브라우저에서는 로그아웃
    }
  }
  clearSession();
  showView("login");
  showMsg("login-msg", "로그아웃했어요.", "ok");
}

$("login-button").addEventListener("click", login);
$("login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
$("logout-button").addEventListener("click", logout);
$("denied-logout").addEventListener("click", logout);

// ===== 1. 프로필 =====
const PROFILE_FIELDS = [
  "name", "title", "career_badge", "email", "phone", "location",
  "headline", "intro", "education", "skills", "experience", "quote",
];
let profilePhotoUrl = null;

function showPhotoPreview(url) {
  const box = $("p-photo-preview");
  box.textContent = "";
  if (isWebUrl(url)) {
    const img = el("img");
    img.src = url;
    img.alt = "프로필 사진";
    box.appendChild(img);
  }
}

async function loadProfile() {
  try {
    const rows = await db("profile?id=eq.1&select=*");
    const p = rows[0] || {};
    PROFILE_FIELDS.forEach((key) => {
      $("p-" + key).value = p[key] || "";
    });
    profilePhotoUrl = p.photo_url || null;
    showPhotoPreview(profilePhotoUrl);
  } catch (e) {
    showMsg("profile-msg", "프로필을 불러오지 못했어요. " + e.message, "error");
  }
}

// 사진을 고르면 바로 미리 보기 (아직 올라간 것은 아님)
$("p-photo").addEventListener("change", () => {
  const file = $("p-photo").files[0];
  const problem = checkFile(file, IMAGE_TYPES);
  showMsg("profile-msg", problem, problem ? "error" : "");
  if (problem || !file) {
    $("p-photo").value = "";
    showPhotoPreview(profilePhotoUrl);
    return;
  }
  const box = $("p-photo-preview");
  box.textContent = "";
  const img = el("img");
  img.src = URL.createObjectURL(file);
  img.alt = "고른 사진 미리 보기";
  box.appendChild(img);
});

async function saveProfile() {
  const button = $("profile-save");
  const file = $("p-photo").files[0];
  const problem = checkFile(file, IMAGE_TYPES);
  if (problem) {
    showMsg("profile-msg", problem, "error");
    return;
  }

  button.disabled = true;
  showMsg("profile-msg", "저장 중...");
  try {
    let photoUrl = profilePhotoUrl;
    if (file) photoUrl = await uploadFile(file, "profile");

    const row = { id: 1, photo_url: photoUrl, updated_at: new Date().toISOString() };
    PROFILE_FIELDS.forEach((key) => {
      row[key] = $("p-" + key).value.trim();
    });

    // 줄이 있으면 고치고, 없으면 새로 만든다
    mustChange(await db("profile?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "return=representation,resolution=merge-duplicates" },
      body: row,
    }));

    profilePhotoUrl = photoUrl;
    $("p-photo").value = "";
    showPhotoPreview(profilePhotoUrl);
    showMsg("profile-msg", "저장했어요. 방문자 화면을 새로고침하면 보여요.", "ok");
  } catch (e) {
    showMsg("profile-msg", "저장하지 못했어요. " + e.message, "error");
  } finally {
    button.disabled = false;
  }
}

$("profile-save").addEventListener("click", saveProfile);

// ===== 2. 포트폴리오 카드 + 좋아요 =====
let projects = [];
let editingId = null; // 고치는 중인 카드 id (새 카드면 null)

async function loadProjects() {
  try {
    projects = await db("projects?select=*&order=sort_order.asc,id.asc");
    renderProjects();
  } catch (e) {
    showMsg("projects-msg", "카드를 불러오지 못했어요. " + e.message, "error");
  }
}

function renderProjects() {
  const list = $("project-list");
  list.textContent = "";
  if (projects.length === 0) {
    list.appendChild(el("li", "empty", "아직 카드가 없어요. \"카드 추가\"를 눌러 만들어 보세요."));
    return;
  }

  projects.forEach((project, index) => {
    const li = el("li", "admin-item");

    // 작은 썸네일
    const thumb = el("span", "thumb-img");
    if (isWebUrl(project.thumbnail_url)) {
      const img = el("img");
      img.src = project.thumbnail_url;
      img.alt = "";
      thumb.appendChild(img);
    }

    // 글
    const info = el("div");
    const meta = [project.number, project.category].filter(Boolean).join(" · ");
    info.appendChild(el("span", "card-meta", meta));
    info.appendChild(el("span", "card-title", project.title));
    const likes = el("span", "likes-text", "♥ 세는 중...");
    info.appendChild(likes);
    if (isWebUrl(project.file_url)) {
      const link = el("a", "hint", " · 첨부 파일 보기");
      link.href = project.file_url;
      link.target = "_blank";
      link.rel = "noopener";
      info.appendChild(link);
    }

    // 버튼들
    const buttons = el("div", "row-buttons");
    const up = smallButton("▲ 위로", () => moveProject(index, -1));
    up.disabled = index === 0;
    const down = smallButton("▼ 아래로", () => moveProject(index, 1));
    down.disabled = index === projects.length - 1;
    buttons.append(
      up,
      down,
      smallButton("수정", () => openEditor(project)),
      smallButton("좋아요 초기화", () => resetLikes(project), true),
      smallButton("삭제", () => deleteProject(project), true),
    );

    li.append(thumb, info, buttons);
    list.appendChild(li);

    loadLikeCount(project.id, likes);
  });
}

function smallButton(text, onClick, danger) {
  const b = el("button", "btn small" + (danger ? " danger" : ""), text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

async function loadLikeCount(projectId, node) {
  try {
    const res = await db("likes?select=id&project_id=eq." + projectId, {
      method: "HEAD",
      headers: { Prefer: "count=exact" },
    });
    const total = parseInt((res.headers.get("content-range") || "").split("/")[1], 10);
    node.textContent = "♥ 좋아요 " + (Number.isNaN(total) ? 0 : total);
  } catch (e) {
    node.textContent = "♥ 좋아요 수를 못 읽었어요";
  }
}

// 순서 올리기·내리기: 바꾼 뒤 위에서부터 1, 2, 3... 으로 다시 매긴다
async function moveProject(index, step) {
  const target = index + step;
  if (target < 0 || target >= projects.length) return;

  const order = projects.slice();
  [order[index], order[target]] = [order[target], order[index]];

  showMsg("projects-msg", "순서를 바꾸는 중...");
  try {
    for (let i = 0; i < order.length; i++) {
      if (order[i].sort_order !== i + 1) {
        mustChange(await db("projects?id=eq." + order[i].id, {
          method: "PATCH",
          body: { sort_order: i + 1 },
        }));
      }
    }
    showMsg("projects-msg", "순서를 바꿨어요.", "ok");
  } catch (e) {
    showMsg("projects-msg", "순서를 바꾸지 못했어요. " + e.message, "error");
  }
  loadProjects();
}

async function deleteProject(project) {
  if (!confirm("\"" + project.title + "\" 카드를 지울까요?\n이 카드의 좋아요도 함께 지워지고, 되돌릴 수 없어요.")) return;
  try {
    mustChange(await db("projects?id=eq." + project.id, { method: "DELETE" }));
    if (editingId === project.id) closeEditor();
    showMsg("projects-msg", "카드를 지웠어요.", "ok");
  } catch (e) {
    showMsg("projects-msg", "지우지 못했어요. " + e.message, "error");
  }
  loadProjects();
}

async function resetLikes(project) {
  if (!confirm("\"" + project.title + "\" 카드의 좋아요를 모두 지우고 0으로 만들까요?\n되돌릴 수 없어요.")) return;
  try {
    // 좋아요가 원래 0개일 수도 있으니 여기서는 mustChange를 쓰지 않는다
    await db("likes?project_id=eq." + project.id, { method: "DELETE" });
    showMsg("projects-msg", "좋아요를 초기화했어요.", "ok");
  } catch (e) {
    showMsg("projects-msg", "초기화하지 못했어요. " + e.message, "error");
  }
  loadProjects();
}

// ----- 카드 추가·수정 칸 -----
function showCurrentFile(id, url, label) {
  const node = $(id);
  node.textContent = "";
  if (isWebUrl(url)) {
    node.appendChild(document.createTextNode("지금 " + label + ": "));
    const link = el("a", null, "열어 보기");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    node.appendChild(link);
    node.appendChild(document.createTextNode(" (새로 고르면 바뀌어요)"));
  } else {
    node.textContent = "아직 " + label + "이 없어요.";
  }
}

function openEditor(project) {
  editingId = project ? project.id : null;
  $("editor-title").textContent = project ? "카드 수정" : "카드 추가";
  $("e-number").value = project ? project.number : "";
  $("e-category").value = project ? project.category : "";
  $("e-title").value = project ? project.title : "";
  $("e-description").value = project ? project.description : "";
  $("e-tags").value = project ? (project.tags || []).join(", ") : "";
  $("e-thumbnail").value = "";
  $("e-file").value = "";
  showCurrentFile("e-thumbnail-now", project && project.thumbnail_url, "썸네일");
  showCurrentFile("e-file-now", project && project.file_url, "첨부 파일");
  showMsg("editor-msg", "");
  $("editor").hidden = false;
  $("e-title").focus();
}

function closeEditor() {
  editingId = null;
  $("editor").hidden = true;
}

async function saveProject() {
  const title = $("e-title").value.trim();
  if (!title) {
    showMsg("editor-msg", "제목을 적어 주세요.", "error");
    return;
  }

  const thumbFile = $("e-thumbnail").files[0];
  const attachFile = $("e-file").files[0];
  const problem = checkFile(thumbFile, IMAGE_TYPES) || checkFile(attachFile, FILE_TYPES);
  if (problem) {
    showMsg("editor-msg", problem, "error");
    return;
  }

  const button = $("editor-save");
  button.disabled = true;
  showMsg("editor-msg", "저장 중...");
  try {
    const row = {
      number: $("e-number").value.trim(),
      category: $("e-category").value.trim(),
      title,
      description: $("e-description").value.trim(),
      tags: $("e-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (thumbFile) row.thumbnail_url = await uploadFile(thumbFile, "projects");
    if (attachFile) row.file_url = await uploadFile(attachFile, "projects");

    if (editingId) {
      mustChange(await db("projects?id=eq." + editingId, { method: "PATCH", body: row }));
    } else {
      // 새 카드는 맨 뒤에 붙인다
      row.sort_order = projects.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
      mustChange(await db("projects", { method: "POST", body: row }));
    }

    closeEditor();
    showMsg("projects-msg", "카드를 저장했어요.", "ok");
    loadProjects();
  } catch (e) {
    showMsg("editor-msg", "저장하지 못했어요. " + e.message, "error");
  } finally {
    button.disabled = false;
  }
}

// 파일을 고르면 바로 확인해서 안내
$("e-thumbnail").addEventListener("change", () => {
  const problem = checkFile($("e-thumbnail").files[0], IMAGE_TYPES);
  showMsg("editor-msg", problem, problem ? "error" : "");
  if (problem) $("e-thumbnail").value = "";
});
$("e-file").addEventListener("change", () => {
  const problem = checkFile($("e-file").files[0], FILE_TYPES);
  showMsg("editor-msg", problem, problem ? "error" : "");
  if (problem) $("e-file").value = "";
});

$("project-new").addEventListener("click", () => openEditor(null));
$("editor-save").addEventListener("click", saveProject);
$("editor-cancel").addEventListener("click", closeEditor);

// ===== 3. 방명록 =====
async function loadGuestbook() {
  const list = $("guestbook-list");
  try {
    const rows = await db("resume_guestbook?select=*&order=created_at.desc");
    list.textContent = "";
    if (rows.length === 0) {
      list.appendChild(el("li", "empty", "아직 남긴 글이 없어요."));
      return;
    }
    rows.forEach((row) => {
      const li = el("li", "gb-item");
      const text = el("div");
      const head = el("div", "gb-head");
      head.append(el("span", "gb-nick", row.nickname), el("span", "gb-date", formatDate(row.created_at)));
      text.append(head, el("p", "gb-msg", row.message));
      li.append(text, smallButton("삭제", () => deleteGuestbook(row), true));
      list.appendChild(li);
    });
  } catch (e) {
    showMsg("guestbook-msg", "방명록을 불러오지 못했어요. " + e.message, "error");
  }
}

async function deleteGuestbook(row) {
  if (!confirm(row.nickname + " 님의 글을 지울까요?\n\"" + row.message + "\"\n되돌릴 수 없어요.")) return;
  try {
    mustChange(await db("resume_guestbook?id=eq." + row.id, { method: "DELETE" }));
    showMsg("guestbook-msg", "글을 지웠어요.", "ok");
  } catch (e) {
    showMsg("guestbook-msg", "지우지 못했어요. " + e.message, "error");
  }
  loadGuestbook();
}

// ===== 시작: 저장된 로그인이 있으면 바로 관리자 화면으로 =====
session = loadSession();
if (session && session.user) {
  startAdmin();
} else {
  showView("login");
}

"use strict";

const TOKEN_KEY = "hub-announcement-admin-token";

const el = (id) => document.getElementById(id);
const views = {
  login: el("login-view"),
  list: el("list-view"),
};

let token = sessionStorage.getItem(TOKEN_KEY) || "";
let items = [];
let editingId = null;

function show(view) {
  for (const [name, node] of Object.entries(views)) {
    node.hidden = name !== view;
  }
  el("logout").hidden = view !== "list";
  el("account").hidden = view !== "list";
}

function toast(message) {
  const node = el("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    node.hidden = true;
  }, 2400);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && path.startsWith("/api/admin/") && path !== "/api/admin/login") {
    token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    show("login");
    throw new Error("登录已过期，请重新登录");
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data && (data.detail || data.message)) || `请求失败（${response.status}）`);
  }
  return data;
}

function formatTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function toInputValue(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function fromInputValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function render() {
  const list = el("items");
  list.replaceChildren();
  el("empty").hidden = items.length > 0;
  const published = items.filter((item) => item.status === "published").length;
  el("summary").textContent = items.length
    ? `共 ${items.length} 条，其中 ${published} 条已发布`
    : "";

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "item";

    const main = document.createElement("div");
    main.className = "item-main";

    const title = document.createElement("div");
    title.className = "item-title";
    const badge = document.createElement("span");
    badge.className = `badge ${item.status}`;
    badge.textContent = item.status === "published" ? "已发布" : "已下架";
    const name = document.createElement("span");
    name.textContent = item.title;
    title.append(badge, name);

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `发布 ${formatTime(item.published_at)} · 更新 ${formatTime(
      item.updated_at,
    )} · 版本 ${item.content_version}`;

    main.append(title, meta);

    if (item.body_md) {
      const body = document.createElement("p");
      body.className = "item-body";
      body.textContent = item.body_md;
      main.append(body);
    }

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost";
    edit.textContent = "编辑";
    edit.addEventListener("click", () => openEditor(item));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ghost";
    toggle.textContent = item.status === "published" ? "下架" : "上架";
    toggle.addEventListener("click", () => setStatus(item, item.status === "published" ? "unpublished" : "published"));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "删除";
    remove.addEventListener("click", () => removeItem(item));

    actions.append(edit, toggle, remove);
    li.append(main, actions);
    list.append(li);
  }
}

async function load() {
  try {
    const data = await api("/api/admin/announcements");
    items = (data && data.items) || [];
    show("list");
    el("account").textContent = "已登录";
    render();
  } catch (error) {
    if (token) toast(error.message);
    show("login");
  }
}

async function setStatus(item, status) {
  try {
    await api(`/api/admin/announcements/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    toast(status === "published" ? "已上架" : "已下架，租户下一次轮询后看不到它");
    await load();
  } catch (error) {
    toast(error.message);
  }
}

async function removeItem(item) {
  if (!confirm(`删除《${item.title}》？删除后租户侧也会消失，且无法恢复。`)) return;
  try {
    await api(`/api/admin/announcements/${item.id}`, { method: "DELETE" });
    toast("已删除");
    await load();
  } catch (error) {
    toast(error.message);
  }
}

function openEditor(item) {
  editingId = item ? item.id : null;
  el("editor-title").textContent = item ? "编辑公告" : "新建公告";
  el("title").value = item ? item.title : "";
  el("body").value = item ? item.body_md : "";
  el("published-at").value = toInputValue(item ? item.published_at : null);
  el("status").value = item ? item.status : "published";
  el("editor-error").hidden = true;
  el("editor").hidden = false;
  el("title").focus();
}

function closeEditor() {
  editingId = null;
  el("editor").hidden = true;
}

async function save(event) {
  event.preventDefault();
  const payload = {
    title: el("title").value.trim(),
    body_md: el("body").value,
    status: el("status").value,
  };
  const publishedAt = fromInputValue(el("published-at").value);
  if (publishedAt) payload.published_at = publishedAt;

  try {
    if (editingId) {
      await api(`/api/admin/announcements/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      toast("已保存，改了内容会重新出现在租户首页");
    } else {
      await api("/api/admin/announcements", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast("已创建");
    }
    closeEditor();
    await load();
  } catch (error) {
    const node = el("editor-error");
    node.textContent = error.message;
    node.hidden = false;
  }
}

el("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: el("password").value }),
    });
    token = data.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    el("password").value = "";
    await load();
  } catch (error) {
    toast(error.message);
  }
});

el("logout").addEventListener("click", () => {
  token = "";
  sessionStorage.removeItem(TOKEN_KEY);
  items = [];
  show("login");
});

el("create").addEventListener("click", () => openEditor(null));
el("cancel").addEventListener("click", closeEditor);
el("editor-form").addEventListener("submit", save);
el("editor").addEventListener("click", (event) => {
  if (event.target === el("editor")) closeEditor();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !el("editor").hidden) closeEditor();
});

if (token) {
  load();
} else {
  show("login");
}

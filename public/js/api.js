// Общий клиент REST API + хранение токена авторизации.
// Подключается на всех страницах перед основным скриптом страницы.

const Api = (() => {
  const TOKEN_KEY = "quizroom_token";
  const USER_KEY = "quizroom_user";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }
  function getUser() {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  function isLoggedIn() {
    return !!getToken();
  }

  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Ошибка запроса (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    del: (path) => request("DELETE", path),
    getToken,
    getUser,
    setSession,
    clearSession,
    isLoggedIn,
  };
})();

// Требует авторизацию — иначе редиректит на главную с формой входа.
function requireAuthOrRedirect() {
  if (!Api.isLoggedIn()) {
    window.location.href = "/index.html?next=" + encodeURIComponent(location.pathname + location.search);
    return false;
  }
  return true;
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

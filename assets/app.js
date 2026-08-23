import { auth, db, googleProvider } from "./firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const DATA_URLS = { students: "data/students.json", tests: "data/tests.json" };
const TEACHER_EMAIL = "hachithanh2251999@gmail.com";
const STUDENT_EMAIL_DOMAIN = "pis-tests.local";
const FEATURED_TEST_ID = "unit-1-1-vocab";

const state = {
  allStudents: [], students: [], tests: [], reports: [],
  selectedStudentId: null, activeTab: "reports", query: "",
  role: null, session: null, release: { released: false },
  unsubscribeReports: null, unsubscribeRelease: null
};

const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const el = id => document.getElementById(id);

function normalizeText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function initials(fullName) {
  return fullName.trim().split(/\s+/).slice(-2).map(part => part[0]).join("").toUpperCase();
}

function validReport(report) {
  return Boolean(report && typeof report.studentId === "string" && typeof report.testId === "string" && Number.isFinite(Number(report.score)) && Number.isFinite(Number(report.maxScore)) && Number(report.maxScore) > 0 && !Number.isNaN(new Date(report.submittedAt).getTime()));
}

function studentReports(studentId) {
  return state.reports.filter(report => report.studentId === studentId && validReport(report)).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function testName(testId) {
  return state.tests.find(test => test.id === testId)?.title || "Untitled test";
}

function percent(report) { return Math.round((Number(report.score) / Number(report.maxScore)) * 100); }
function formatScore(report) { return `${Number(report.score).toLocaleString("en-GB")}/${Number(report.maxScore).toLocaleString("en-GB")}`; }
function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return "—";
  const minutes = Math.floor(Number(seconds) / 60);
  const remaining = Number(seconds) % 60;
  return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
}

function statsFor(studentId) {
  const reports = studentReports(studentId);
  if (!reports.length) return { count: 0, average: null, best: null };
  const percentages = reports.map(percent);
  return {
    count: new Set(reports.map(report => report.testId)).size,
    average: Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length),
    best: Math.max(...percentages)
  };
}

function setSyncStatus(label, connected = true) {
  const status = el("sync-status");
  status.lastChild.textContent = ` ${label}`;
  status.classList.toggle("offline", !connected);
}

function renderStudentList() {
  const list = el("student-list");
  const queryText = normalizeText(state.query.trim());
  const filtered = state.students.filter(student => normalizeText(`${student.fullName} ${student.nickname || ""}`).includes(queryText));
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "no-search-results";
    empty.textContent = "No matching student found.";
    list.append(empty);
    return;
  }
  filtered.forEach(student => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `student-button${student.id === state.selectedStudentId ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(student.id === state.selectedStudentId));
    button.innerHTML = `<span class="mini-avatar" aria-hidden="true">${initials(student.fullName)}</span><span class="student-name"><strong>${escapeHtml(student.fullName)}</strong><small>${student.nickname ? `Nickname: ${escapeHtml(student.nickname)}` : "No nickname"}</small></span><span class="chevron" aria-hidden="true">›</span>`;
    button.addEventListener("click", () => selectStudent(student.id));
    list.append(button);
  });
}

function selectStudent(studentId) {
  if (state.role === "student" && studentId !== state.session?.studentId) return;
  state.selectedStudentId = studentId;
  renderStudentList();
  renderProfile();
  history.replaceState(null, "", `#student=${encodeURIComponent(studentId)}`);
}

function renderProfile() {
  const student = state.allStudents.find(item => item.id === state.selectedStudentId);
  if (!student) return;
  const stats = statsFor(student.id);
  el("profile-avatar").textContent = initials(student.fullName);
  el("profile-name").textContent = student.fullName;
  el("profile-nickname").textContent = student.nickname ? `Nickname: ${student.nickname}` : "No nickname";
  el("profile-tests").textContent = stats.count;
  el("profile-average").textContent = stats.average === null ? "—" : `${stats.average}%`;
  el("profile-best").textContent = stats.best === null ? "—" : `${stats.best}%`;
  renderAvailableTests(student.id);
  renderReports(student.id);
  renderTotals(student.id);
}

function emptyState(icon, title, description) {
  return `<div class="empty-state"><div><span class="empty-icon" aria-hidden="true">${icon}</span><h4>${title}</h4><p>${description}</p></div></div>`;
}

function renderAvailableTests(studentId) {
  const container = el("available-tests");
  if (!container) return;
  if (!state.tests.length) {
    container.innerHTML = emptyState("✦", "No tests are available", "Your teacher will publish a test here.");
    return;
  }
  const reports = studentReports(studentId);
  container.innerHTML = state.tests.map(test => {
    const report = reports.find(item => item.testId === test.id);
    const actionLabel = report ? "View result" : "Start test";
    return `<article class="test-card">
      <div class="test-card-icon" aria-hidden="true">Aa</div>
      <div class="test-card-copy"><span class="test-status ${report ? "complete" : "available"}">${report ? `Submitted · ${formatScore(report)}` : "Available now"}</span><h4>${escapeHtml(test.title)}</h4><p>${escapeHtml(test.description)}</p><small>${test.questions} questions · ${test.points} points · One attempt</small></div>
      <a class="test-action" href="${escapeHtml(test.path)}">${actionLabel} <span>→</span></a>
    </article>`;
  }).join("");
}

function renderReports(studentId) {
  const reports = studentReports(studentId);
  const container = el("reports-content");
  if (!reports.length) {
    container.innerHTML = emptyState("✓", "No test reports yet", "A new report will appear here automatically after the student submits a test.");
    return;
  }
  container.innerHTML = `<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Test</th><th>Score</th><th>Percentage</th><th>Time spent</th><th>Submitted</th></tr></thead><tbody>${reports.map(report => `<tr><td><strong>${escapeHtml(testName(report.testId))}</strong></td><td><span class="score-chip">${formatScore(report)}</span></td><td>${percent(report)}%</td><td>${formatDuration(report.durationSeconds)}</td><td>${dateFormatter.format(new Date(report.submittedAt))}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderTotals(studentId) {
  const reports = studentReports(studentId);
  const container = el("total-content");
  if (!reports.length) {
    container.innerHTML = emptyState("∑", "No scores to summarize", "This tab calculates the best score for each completed test.");
    return;
  }
  const bestByTest = new Map();
  reports.forEach(report => {
    const current = bestByTest.get(report.testId);
    if (!current || percent(report) > percent(current)) bestByTest.set(report.testId, report);
  });
  const bestReports = [...bestByTest.values()];
  const average = Math.round(bestReports.reduce((sum, report) => sum + percent(report), 0) / bestReports.length);
  const totalScore = bestReports.reduce((sum, report) => sum + Number(report.score), 0);
  const totalMax = bestReports.reduce((sum, report) => sum + Number(report.maxScore), 0);
  container.innerHTML = `<div class="total-summary"><div class="summary-card"><span>Tests completed</span><strong>${bestReports.length}</strong></div><div class="summary-card"><span>Average score</span><strong>${average}%</strong></div><div class="summary-card"><span>Total best score</span><strong>${totalScore}/${totalMax}</strong></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Test</th><th>Best score</th><th>Percentage</th><th>Attempts</th></tr></thead><tbody>${bestReports.map(report => `<tr><td><strong>${escapeHtml(testName(report.testId))}</strong></td><td><span class="score-chip">${formatScore(report)}</span></td><td>${percent(report)}%</td><td>${reports.filter(item => item.testId === report.testId).length}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderReleaseControl() {
  const released = state.release.released === true;
  el("release-status").textContent = released ? "Answers and explanations are open for students who submitted this test." : "Answers are locked. Students can see their score only.";
  el("release-toggle").textContent = released ? "Lock explanations" : "Release explanations";
  el("release-toggle").setAttribute("aria-pressed", String(released));
  document.querySelector(".release-card")?.classList.toggle("released", released);
}

async function toggleRelease() {
  if (state.role !== "teacher" || !auth.currentUser) return;
  const button = el("release-toggle");
  button.disabled = true;
  try {
    await setDoc(doc(db, "testReleases", FEATURED_TEST_ID), {
      testId: FEATURED_TEST_ID,
      released: !state.release.released,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.email
    }, { merge: true });
  } catch (error) {
    console.error(error);
    el("release-status").textContent = "The release setting could not be changed. Please try again.";
  } finally {
    button.disabled = false;
  }
}

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => {
    state.activeTab = button.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach(tab => {
      const active = tab.dataset.tab === state.activeTab;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    el("reports-panel").hidden = state.activeTab !== "reports";
    el("total-panel").hidden = state.activeTab !== "total";
  }));
}

function setLoginTab(tabName) {
  document.querySelectorAll("[data-login-tab]").forEach(button => {
    const active = button.dataset.loginTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  el("student-login-form").hidden = tabName !== "student";
  el("teacher-login-form").hidden = tabName !== "teacher";
}

function authMessage(error) {
  const code = error?.code || "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) return "The username or password is incorrect.";
  if (code === "auth/too-many-requests") return "Too many unsuccessful attempts. Please try again later.";
  if (code === "auth/popup-closed-by-user") return "The Google sign-in window was closed too early.";
  if (code === "auth/unauthorized-domain") return "This website has not been authorized in Firebase.";
  return "Sign-in is not available right now. Please try again.";
}

async function handleStudentLogin(event) {
  event.preventDefault();
  const errorEl = el("student-login-error");
  const username = el("student-username").value.trim().toLowerCase();
  const password = el("student-password").value;
  if (!/^[a-z0-9._-]+$/.test(username)) {
    errorEl.textContent = "Use lowercase letters, numbers, dots, hyphens, or underscores only.";
    return;
  }
  errorEl.textContent = "";
  try { await signInWithEmailAndPassword(auth, `${username}@${STUDENT_EMAIL_DOMAIN}`, password); }
  catch (error) { errorEl.textContent = authMessage(error); }
}

async function handleTeacherLogin(event) {
  event.preventDefault();
  el("teacher-login-error").textContent = "";
  try { await signInWithPopup(auth, googleProvider); }
  catch (error) { el("teacher-login-error").textContent = authMessage(error); }
}

function bindAuth() {
  document.querySelectorAll("[data-login-tab]").forEach(button => button.addEventListener("click", () => setLoginTab(button.dataset.loginTab)));
  el("student-login-form").addEventListener("submit", handleStudentLogin);
  el("teacher-login-form").addEventListener("submit", handleTeacherLogin);
  el("logout-button").addEventListener("click", () => signOut(auth));
  el("release-toggle").addEventListener("click", toggleRelease);
}

function showLogin() {
  state.unsubscribeReports?.(); state.unsubscribeRelease?.();
  state.unsubscribeReports = null; state.unsubscribeRelease = null;
  state.session = null; state.role = null; state.reports = [];
  document.body.classList.remove("student-mode", "teacher-mode");
  el("app-shell").hidden = true;
  el("login-shell").hidden = false;
  history.replaceState(null, "", location.pathname);
}

function startListeners(user) {
  state.unsubscribeReports?.(); state.unsubscribeRelease?.();
  const reportsRef = collection(db, "reports");
  const reportsQuery = state.role === "teacher" ? reportsRef : query(reportsRef, where("uid", "==", user.uid));
  state.unsubscribeReports = onSnapshot(reportsQuery, snapshot => {
    state.reports = snapshot.docs.map(reportDoc => {
      const data = reportDoc.data();
      const submittedAt = data.submittedAt?.toDate ? data.submittedAt.toDate().toISOString() : data.submittedAt;
      return { id: reportDoc.id, ...data, submittedAt };
    });
    setSyncStatus("Synced with Firebase", true);
    renderProfile();
  }, error => { console.error(error); setSyncStatus("Firebase connection lost", false); });
  state.unsubscribeRelease = onSnapshot(doc(db, "testReleases", FEATURED_TEST_ID), snapshot => {
    state.release = snapshot.exists() ? snapshot.data() : { released: false };
    renderReleaseControl();
  }, error => console.error("Release status error", error));
}

function openApp(user, session) {
  state.session = session;
  state.role = session.role;
  document.body.classList.toggle("student-mode", session.role === "student");
  document.body.classList.toggle("teacher-mode", session.role === "teacher");
  el("login-shell").hidden = true;
  el("app-shell").hidden = false;
  state.students = [...state.allStudents];
  if (session.role === "student") {
    const student = state.allStudents.find(item => item.id === session.studentId);
    if (!student) throw new Error("The student profile does not exist.");
    state.selectedStudentId = student.id;
    el("session-label").textContent = student.nickname || student.fullName;
    el("student-count").textContent = "1";
    el("hero-student-count").textContent = "1";
  } else {
    const requestedId = new URLSearchParams(location.hash.replace(/^#/, "")).get("student");
    state.selectedStudentId = state.students.some(student => student.id === requestedId) ? requestedId : state.students[0]?.id || null;
    el("session-label").textContent = "Teacher: Mr. Hà Chí Thanh";
    el("student-count").textContent = state.students.length;
    el("hero-student-count").textContent = state.students.length;
  }
  renderStudentList(); renderProfile(); renderReleaseControl();
  el("loading-state").hidden = true;
  el("profile-content").hidden = false;
  startListeners(user);
}

async function resolveSession(user) {
  if (user.email?.toLowerCase() === TEACHER_EMAIL) return { role: "teacher" };
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));
  if (!profileSnapshot.exists()) throw new Error("This account is not linked to a student profile.");
  const profile = profileSnapshot.data();
  if (profile.role !== "student" || !state.allStudents.some(student => student.id === profile.studentId)) throw new Error("The student profile is not valid.");
  return { role: "student", studentId: profile.studentId };
}

async function recordReport(payload) {
  if (state.role !== "student" || !state.session?.studentId || !auth.currentUser) throw new Error("A student must sign in before submitting a test.");
  const report = { uid: auth.currentUser.uid, studentId: state.session.studentId, testId: String(payload.testId || ""), score: Number(payload.score), maxScore: Number(payload.maxScore), durationSeconds: Number(payload.durationSeconds || 0), submittedAt: payload.submittedAt || new Date().toISOString(), createdAt: serverTimestamp(), details: payload.details || null };
  if (!validReport(report)) throw new Error("The report data is not valid.");
  const result = await addDoc(collection(db, "reports"), report);
  return { id: result.id, ...report };
}

window.PISTracker = Object.freeze({ recordReport, currentStudentId: () => state.session?.studentId || null });

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json();
}

async function init() {
  bindAuth(); bindTabs();
  el("student-search").addEventListener("input", event => { state.query = event.target.value; renderStudentList(); });
  try {
    const [studentData, testData] = await Promise.all([loadJson(DATA_URLS.students), loadJson(DATA_URLS.tests)]);
    state.allStudents = [...studentData.students].sort((a, b) => collator.compare(a.fullName, b.fullName));
    state.tests = testData.tests || [];
    onAuthStateChanged(auth, async user => {
      if (!user) return showLogin();
      try { openApp(user, await resolveSession(user)); }
      catch (error) { console.error(error); await signOut(auth); el("student-login-error").textContent = error.message; }
    });
  } catch (error) {
    console.error(error);
    el("login-shell").hidden = true; el("app-shell").hidden = false;
    el("loading-state").hidden = true; el("error-state").hidden = false;
  }
}

init();

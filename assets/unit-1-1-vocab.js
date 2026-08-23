import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const TEST_ID = "unit-1-1-vocab";
const TEACHER_EMAIL = "hachithanh2251999@gmail.com";
const QUESTION_URL = "../data/unit-1-1-vocab.json";
const SOLUTION_URL = "../data/unit-1-1-vocab-solutions.json";
const TEST_DURATION_SECONDS = 10 * 60;

const state = {
  user: null,
  student: null,
  test: null,
  report: null,
  testSession: null,
  released: false,
  unsubscribeRelease: null,
  timerId: null,
  active: false,
  completed: false,
  submitting: false,
  resuming: false,
  lastViolationAt: 0,
  writeQueue: Promise.resolve()
};

const el = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function flattenQuestions() {
  return state.test.sections.flatMap(section => section.questions);
}

function reportRef() {
  return doc(db, "reports", `${TEST_ID}_${state.user.uid}`);
}

function sessionRef() {
  return doc(db, "testSessions", `${TEST_ID}_${state.user.uid}`);
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function requestTestFullscreen() {
  const target = document.documentElement;
  const request = target.requestFullscreen || target.webkitRequestFullscreen;
  if (!request) throw new Error("Fullscreen mode is not supported on this browser. Please use an updated version of Chrome, Edge, or Safari.");
  await request.call(target);
}

async function leaveFullscreen() {
  if (!fullscreenElement()) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (exit) await exit.call(document).catch(() => {});
}

function renderQuestions() {
  let questionNumber = 0;
  el("question-sections").innerHTML = state.test.sections.map((section, sectionIndex) => `
    <section class="section-block" aria-labelledby="section-${sectionIndex + 1}">
      <div class="section-heading">
        <span class="section-number">${sectionIndex + 1}</span>
        <div><h2 id="section-${sectionIndex + 1}">${escapeHtml(section.title)}</h2><p>${escapeHtml(section.description)}</p></div>
      </div>
      ${section.questions.map(question => {
        const index = questionNumber++;
        return `<fieldset class="question-card">
          <legend><span class="question-number">${index + 1}</span>${escapeHtml(question.prompt)}</legend>
          <div class="option-grid">
            ${question.options.map((option, optionIndex) => `<label class="option">
              <input type="radio" name="question-${index}" value="${optionIndex}" required>
              <span class="option-marker">${String.fromCharCode(65 + optionIndex)}</span>
              <span class="option-text">${escapeHtml(option)}</span>
            </label>`).join("")}
          </div>
        </fieldset>`;
      }).join("")}
    </section>
  `).join("");
  el("test-form").addEventListener("change", () => {
    updateProgress();
    if (state.active) {
      state.testSession.answers = selectedAnswers();
      queueSessionWrite();
    }
  });
}

function selectedAnswers() {
  return flattenQuestions().map((_, index) => {
    const selected = document.querySelector(`input[name="question-${index}"]:checked`);
    return selected ? Number(selected.value) : -1;
  });
}

function restoreAnswers(answers = []) {
  answers.forEach((answer, index) => {
    if (!Number.isInteger(answer) || answer < 0) return;
    const input = document.querySelector(`input[name="question-${index}"][value="${answer}"]`);
    if (input) input.checked = true;
  });
  updateProgress();
}

function updateProgress() {
  const total = flattenQuestions().length;
  const answered = selectedAnswers().filter(answer => answer >= 0).length;
  const percentage = Math.round((answered / total) * 100);
  el("progress-label").textContent = `${answered} of ${total} answered`;
  el("progress-percent").textContent = `${percentage}%`;
  el("progress-bar").style.width = `${percentage}%`;
}

function showAccountError(message) {
  state.active = false;
  clearInterval(state.timerId);
  el("account-gate").hidden = false;
  el("account-gate").innerHTML = `<div><strong>Unable to open this test</strong><p>${escapeHtml(message)}</p><p><a href="../index.html">Return to the sign-in page</a></p></div>`;
}

function showStartGate(isResume) {
  el("account-gate").hidden = false;
  el("account-gate").innerHTML = `<span class="start-medallion" aria-hidden="true">⏱</span><div class="start-copy"><strong>${isResume ? "Resume your timed test" : "Ready to begin?"}</strong><p>${isResume ? "Your 10-minute timer has continued running since you first started." : "You will have 10 minutes. The test opens in fullscreen and leaving it is recorded for your teacher."}</p><button class="submit-button gate-start-button" id="start-test-button" type="button">${isResume ? "Resume in fullscreen" : "Start 10-minute test"}</button><p class="gate-error" id="start-test-error" role="alert"></p></div>`;
  el("start-test-button").addEventListener("click", () => beginOrResumeTest(isResume));
}

function sessionPayload() {
  return {
    uid: state.user.uid,
    studentId: state.student.id,
    testId: TEST_ID,
    status: state.testSession.status,
    startedAt: state.testSession.startedAt,
    deadlineAt: state.testSession.deadlineAt,
    durationLimitSeconds: TEST_DURATION_SECONDS,
    answers: state.testSession.answers,
    exitCount: state.testSession.exitCount,
    lastExitReason: state.testSession.lastExitReason || "",
    updatedAt: serverTimestamp()
  };
}

function queueSessionWrite() {
  state.writeQueue = state.writeQueue.then(() => setDoc(sessionRef(), sessionPayload())).catch(error => {
    console.error("Session save error", error);
    el("submit-message").textContent = "Your test activity could not sync. Check your connection before submitting.";
  });
  return state.writeQueue;
}

async function createSession() {
  const startedAt = new Date();
  state.testSession = {
    status: "in_progress",
    startedAt: startedAt.toISOString(),
    deadlineAt: new Date(startedAt.getTime() + TEST_DURATION_SECONDS * 1000).toISOString(),
    answers: Array(flattenQuestions().length).fill(-1),
    exitCount: 0,
    lastExitReason: ""
  };
  await setDoc(sessionRef(), sessionPayload());
}

async function beginOrResumeTest(isResume) {
  const button = el("start-test-button");
  button.disabled = true;
  el("start-test-error").textContent = "";
  try {
    await requestTestFullscreen();
    if (!state.testSession) await createSession();
    state.active = true;
    state.resuming = isResume;
    state.completed = false;
    el("account-gate").hidden = true;
    el("test-form").hidden = false;
    el("progress-dock").hidden = false;
    el("timer-display").hidden = false;
    el("dashboard-link").hidden = true;
    restoreAnswers(state.testSession.answers);
    if (isResume) await recordViolation("Test page reopened during an active attempt", false);
    tickTimer();
    clearInterval(state.timerId);
    state.timerId = setInterval(tickTimer, 250);
    window.scrollTo({ top: el("progress-dock").offsetTop - 12, behavior: "smooth" });
  } catch (error) {
    console.error(error);
    el("start-test-error").textContent = error.message || "Fullscreen could not be opened. Please allow fullscreen and try again.";
    button.disabled = false;
  }
}

function remainingSeconds() {
  if (!state.testSession?.deadlineAt) return TEST_DURATION_SECONDS;
  return Math.max(0, Math.ceil((new Date(state.testSession.deadlineAt).getTime() - Date.now()) / 1000));
}

function tickTimer() {
  const remaining = remainingSeconds();
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  el("timer-display").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  el("timer-display").classList.toggle("urgent", remaining <= 60);
  if (remaining <= 0 && state.active && !state.submitting) completeTest(true);
}

async function recordViolation(reason, showLock = true) {
  if (!state.active || state.completed || !state.testSession) return;
  const now = Date.now();
  if (now - state.lastViolationAt < 1500) return;
  state.lastViolationAt = now;
  state.testSession.exitCount = Number(state.testSession.exitCount || 0) + 1;
  state.testSession.lastExitReason = reason;
  el("student-exit-count").textContent = state.testSession.exitCount;
  if (showLock) el("fullscreen-lock").hidden = false;
  await queueSessionWrite();
}

function handleFullscreenChange() {
  if (!state.active || state.completed) return;
  if (fullscreenElement()) {
    el("fullscreen-lock").hidden = true;
    return;
  }
  recordViolation("Fullscreen exited");
}

async function returnToFullscreen() {
  const button = el("return-fullscreen-button");
  button.disabled = true;
  try {
    await requestTestFullscreen();
    el("fullscreen-lock").hidden = true;
  } catch (error) {
    console.error(error);
    button.textContent = "Fullscreen blocked — try again";
  } finally {
    button.disabled = false;
  }
}

function renderSubmittedReport() {
  const score = Number(state.report.score);
  const maxScore = Number(state.report.maxScore);
  const percentage = Math.round((score / maxScore) * 100);
  state.active = false;
  state.completed = true;
  clearInterval(state.timerId);
  el("test-form").hidden = true;
  el("progress-dock").hidden = true;
  el("timer-display").hidden = true;
  el("fullscreen-lock").hidden = true;
  el("dashboard-link").hidden = false;
  el("result-score").textContent = `${score}/${maxScore}`;
  el("result-percent").textContent = `${percentage}%`;
  el("result-title").textContent = percentage >= 80 ? "Excellent work!" : percentage >= 60 ? "Good progress!" : "Keep building your vocabulary!";
  el("result-card").hidden = false;
  el("explanation-card").hidden = false;
  leaveFullscreen();
  renderExplanationState();
}

function renderExplanationState() {
  if (!state.report) return;
  if (!state.released) {
    el("lock-medallion").textContent = "🔒";
    el("explanation-title").textContent = "Explanations are locked";
    el("explanation-copy").textContent = "Your teacher will release the answers from the dashboard.";
    el("solution-list").replaceChildren();
    return;
  }
  el("lock-medallion").textContent = "🔓";
  el("explanation-title").textContent = "Answers and explanations";
  el("explanation-copy").textContent = "Your teacher has opened the review for this test.";
  loadAndRenderSolutions();
}

function base64Bytes(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function decryptSolutions(payload, encodedKey) {
  const key = await crypto.subtle.importKey("raw", base64Bytes(encodedKey), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Bytes(payload.iv), tagLength: 128 },
    key,
    base64Bytes(payload.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function loadAndRenderSolutions() {
  const list = el("solution-list");
  list.innerHTML = "<p>Loading the answer review…</p>";
  try {
    const [unlockSnapshot, response] = await Promise.all([
      getDoc(doc(db, "testUnlocks", TEST_ID)),
      fetch(SOLUTION_URL, { cache: "no-store" })
    ]);
    if (!unlockSnapshot.exists() || !response.ok) throw new Error("The answer review is not available.");
    const solutions = await decryptSolutions(await response.json(), unlockSnapshot.data().key);
    const questions = flattenQuestions();
    const studentAnswers = state.report.details?.answers || [];
    list.innerHTML = solutions.answers.map((solution, index) => {
      const isCorrect = studentAnswers[index] === solution.correctIndex;
      const chosen = questions[index]?.options[studentAnswers[index]] || "No answer";
      return `<article class="solution-item">
        <header><h3>Question ${index + 1}</h3><strong class="${isCorrect ? "correct" : "incorrect"}">${isCorrect ? "Correct" : "Review"}</strong></header>
        <p>Your answer: ${escapeHtml(chosen)}</p>
        <p class="solution-answer">Correct answer: ${escapeHtml(solution.answer)}</p>
        <p>${escapeHtml(solution.explanation)}</p>
      </article>`;
    }).join("");
  } catch (error) {
    console.error(error);
    list.innerHTML = "<p>The review could not be loaded yet. Please refresh the page in a moment.</p>";
  }
}

function startReleaseListener() {
  state.unsubscribeRelease?.();
  state.unsubscribeRelease = onSnapshot(doc(db, "testReleases", TEST_ID), snapshot => {
    state.released = snapshot.exists() && snapshot.data().released === true;
    renderExplanationState();
  }, error => console.error("Release status error", error));
}

async function submitWithValidatedScore(answers, durationSeconds, autoSubmitted) {
  const baseReport = {
    uid: state.user.uid,
    studentId: state.student.id,
    testId: TEST_ID,
    maxScore: state.test.maxScore,
    durationSeconds,
    submittedAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
    details: {
      answers,
      exitCount: Number(state.testSession?.exitCount || 0),
      autoSubmitted: Boolean(autoSubmitted)
    }
  };

  for (let candidateScore = 0; candidateScore <= state.test.maxScore; candidateScore += 1) {
    try {
      await setDoc(reportRef(), { ...baseReport, score: candidateScore });
      return { ...baseReport, score: candidateScore };
    } catch (error) {
      if (error?.code !== "permission-denied") throw error;
    }
  }
  throw new Error("Secure grading is not available yet. Please ask your teacher to try again.");
}

async function completeTest(autoSubmitted) {
  if (state.submitting || state.completed) return;
  const answers = selectedAnswers();
  if (!autoSubmitted && answers.some(answer => answer < 0)) {
    el("submit-message").textContent = "Please answer all 10 questions before submitting.";
    document.querySelector(".question-card:has(input:invalid)")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  state.submitting = true;
  const submitButton = el("submit-button");
  submitButton.disabled = true;
  submitButton.textContent = autoSubmitted ? "Time is up — submitting…" : "Grading securely…";
  el("submit-message").textContent = autoSubmitted ? "The 10-minute limit has ended. Your saved answers are being submitted." : "";
  try {
    state.testSession.answers = answers;
    const durationSeconds = Math.min(TEST_DURATION_SECONDS, Math.max(0, Math.round((Date.now() - new Date(state.testSession.startedAt).getTime()) / 1000)));
    state.report = await submitWithValidatedScore(answers, durationSeconds, autoSubmitted);
    state.completed = true;
    state.active = false;
    state.testSession.status = "submitted";
    await queueSessionWrite();
    renderSubmittedReport();
    window.scrollTo({ top: el("result-card").offsetTop - 30, behavior: "smooth" });
  } catch (error) {
    console.error(error);
    el("submit-message").textContent = error.message || "Your test could not be submitted. Please try again.";
    submitButton.disabled = false;
    submitButton.innerHTML = "Submit test <span>→</span>";
    state.submitting = false;
  }
}

function handleSubmit(event) {
  event.preventDefault();
  completeTest(false);
}

async function loadStudentProfile(user) {
  const [profileSnapshot, studentsResponse] = await Promise.all([
    getDoc(doc(db, "users", user.uid)),
    fetch("../data/students.json", { cache: "no-store" })
  ]);
  if (!profileSnapshot.exists() || !studentsResponse.ok) throw new Error("This account is not linked to a student profile.");
  const profile = profileSnapshot.data();
  const studentData = await studentsResponse.json();
  const baseStudent = studentData.students.find(item => item.id === profile.studentId);
  if (profile.role !== "student" || !baseStudent) throw new Error("This account is not a valid PIS student account.");
  return { ...baseStudent, fullName: profile.fullName || baseStudent.fullName, nickname: profile.nickname || null };
}

async function openTest(user) {
  state.user = user;
  const testResponse = await fetch(QUESTION_URL, { cache: "no-store" });
  if (!testResponse.ok) throw new Error("The test content could not be loaded.");
  state.test = await testResponse.json();

  if (user.email?.toLowerCase() === TEACHER_EMAIL) {
    el("student-identity").textContent = "Teacher preview · Mr. Hà Chí Thanh";
    showAccountError("Teacher preview is available from the dashboard. Student submission is disabled for teacher accounts.");
    return;
  }

  state.student = await loadStudentProfile(user);
  el("student-identity").textContent = `${state.student.nickname || state.student.fullName} · Level PIS`;
  const [releaseSnapshot, existingReport, existingSession] = await Promise.all([
    getDoc(doc(db, "testReleases", TEST_ID)),
    getDoc(reportRef()),
    getDoc(sessionRef())
  ]);
  if (!releaseSnapshot.exists()) throw new Error("This test is being prepared. Please return when your teacher announces that it is ready.");
  state.released = releaseSnapshot.data().released === true;
  startReleaseListener();

  if (existingReport.exists()) {
    state.report = existingReport.data();
    el("account-gate").hidden = true;
    renderSubmittedReport();
    return;
  }

  renderQuestions();
  el("test-form").addEventListener("submit", handleSubmit);
  el("progress-dock").hidden = true;
  updateProgress();

  if (existingSession.exists()) {
    state.testSession = existingSession.data();
    if (state.testSession.status === "submitted") throw new Error("This attempt is already closed. Ask your teacher to delete it before trying again.");
    restoreAnswers(state.testSession.answers);
    if (remainingSeconds() <= 0) {
      state.active = true;
      el("account-gate").hidden = true;
      el("test-form").hidden = false;
      await completeTest(true);
      return;
    }
    showStartGate(true);
    return;
  }

  showStartGate(false);
}

document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) recordViolation("Test tab or app left");
});
window.addEventListener("beforeunload", event => {
  if (!state.active || state.completed) return;
  event.preventDefault();
  event.returnValue = "";
});
el("return-fullscreen-button").addEventListener("click", returnToFullscreen);

onAuthStateChanged(auth, user => {
  if (!user) {
    location.replace("../index.html");
    return;
  }
  openTest(user).catch(error => {
    console.error(error);
    showAccountError(error.message || "The test could not be opened.");
  });
});

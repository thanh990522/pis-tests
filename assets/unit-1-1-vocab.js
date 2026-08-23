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

const state = {
  user: null,
  student: null,
  test: null,
  report: null,
  released: false,
  unsubscribeRelease: null,
  startedAt: Date.now()
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
  el("test-form").addEventListener("change", updateProgress);
}

function selectedAnswers() {
  return flattenQuestions().map((_, index) => {
    const selected = document.querySelector(`input[name="question-${index}"]:checked`);
    return selected ? Number(selected.value) : null;
  });
}

function updateProgress() {
  const total = flattenQuestions().length;
  const answered = selectedAnswers().filter(Number.isInteger).length;
  const percentage = Math.round((answered / total) * 100);
  el("progress-label").textContent = `${answered} of ${total} answered`;
  el("progress-percent").textContent = `${percentage}%`;
  el("progress-bar").style.width = `${percentage}%`;
}

function showAccountError(message) {
  el("account-gate").innerHTML = `<div><strong>Unable to open this test</strong><p>${escapeHtml(message)}</p><p><a href="../index.html">Return to the sign-in page</a></p></div>`;
}

function renderSubmittedReport() {
  const score = Number(state.report.score);
  const maxScore = Number(state.report.maxScore);
  const percentage = Math.round((score / maxScore) * 100);
  el("test-form").hidden = true;
  el("progress-dock").hidden = true;
  el("result-score").textContent = `${score}/${maxScore}`;
  el("result-percent").textContent = `${percentage}%`;
  el("result-title").textContent = percentage >= 80 ? "Excellent work!" : percentage >= 60 ? "Good progress!" : "Keep building your vocabulary!";
  el("result-card").hidden = false;
  el("explanation-card").hidden = false;
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

async function submitWithValidatedScore(answers, durationSeconds) {
  const baseReport = {
    uid: state.user.uid,
    studentId: state.student.id,
    testId: TEST_ID,
    maxScore: state.test.maxScore,
    durationSeconds,
    submittedAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
    details: { answers }
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

async function handleSubmit(event) {
  event.preventDefault();
  const answers = selectedAnswers();
  if (answers.some(answer => !Number.isInteger(answer))) {
    el("submit-message").textContent = "Please answer all 10 questions before submitting.";
    document.querySelector(".question-card:has(input:invalid)")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const submitButton = el("submit-button");
  submitButton.disabled = true;
  submitButton.textContent = "Grading securely…";
  el("submit-message").textContent = "";
  try {
    const durationSeconds = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    state.report = await submitWithValidatedScore(answers, durationSeconds);
    renderSubmittedReport();
    window.scrollTo({ top: el("result-card").offsetTop - 30, behavior: "smooth" });
  } catch (error) {
    console.error(error);
    el("submit-message").textContent = error.message || "Your test could not be submitted. Please try again.";
    submitButton.disabled = false;
    submitButton.innerHTML = "Submit test <span>→</span>";
  }
}

async function loadStudentProfile(user) {
  const [profileSnapshot, studentsResponse] = await Promise.all([
    getDoc(doc(db, "users", user.uid)),
    fetch("../data/students.json", { cache: "no-store" })
  ]);
  if (!profileSnapshot.exists() || !studentsResponse.ok) throw new Error("This account is not linked to a student profile.");
  const profile = profileSnapshot.data();
  const studentData = await studentsResponse.json();
  const student = studentData.students.find(item => item.id === profile.studentId);
  if (profile.role !== "student" || !student) throw new Error("This account is not a valid PIS student account.");
  return student;
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
  const [releaseSnapshot, existingReport] = await Promise.all([
    getDoc(doc(db, "testReleases", TEST_ID)),
    getDoc(reportRef())
  ]);
  if (!releaseSnapshot.exists()) throw new Error("This test is being prepared. Please return when your teacher announces that it is ready.");
  state.released = releaseSnapshot.data().released === true;
  el("account-gate").hidden = true;
  startReleaseListener();

  if (existingReport.exists()) {
    state.report = existingReport.data();
    renderSubmittedReport();
    return;
  }

  renderQuestions();
  el("test-form").hidden = false;
  el("test-form").addEventListener("submit", handleSubmit);
  updateProgress();
}

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

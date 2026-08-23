# PIS Tests

English-language assessment and progress tracking for Viet Anh School, Level PIS.

## Current features

- 11 student profiles listed A–Z.
- Firebase student username/password sign-in and authorized teacher Google sign-in.
- Individual submission history and overall score tabs.
- Real-time Firestore synchronization with the teacher dashboard.
- Unit 1.1 Vocabulary Test with 10 questions and one submission per student.
- Immediate score after submission.
- Teacher-controlled release of answers and explanations.
- Responsive teal, blue, gold, and white interface.

## Test security

The public site contains the questions but not a readable answer key. Unit 1.1 is graded by protected Firestore Security Rules. Explanations are stored as an AES-GCM encrypted payload and can be opened only when:

1. the student has submitted the test; and
2. the teacher releases the review from the dashboard.

The public `firestore.rules` file intentionally fails closed for Unit 1.1. The production grading rule and unlock key are managed privately in Firebase Console and are not committed to this repository.

## Project structure

- `index.html`: student and teacher dashboard.
- `tests/unit-1-1-vocab.html`: Unit 1.1 test page.
- `data/students.json`: student directory.
- `data/tests.json`: published test catalog.
- `data/unit-1-1-vocab.json`: public test questions and options.
- `data/unit-1-1-vocab-solutions.json`: encrypted answer review payload.
- `assets/app.js`: dashboard authentication and real-time reports.
- `assets/unit-1-1-vocab.js`: test rendering, submission, and answer release flow.

## Report structure

```json
{
  "uid": "firebase-user-id",
  "studentId": "pis-001",
  "testId": "unit-1-1-vocab",
  "score": 8,
  "maxScore": 10,
  "submittedAt": "2026-08-23T10:00:00.000Z",
  "durationSeconds": 900,
  "details": { "answers": ["selected-option-index", "..."] }
}
```

Firebase client configuration is public by design. Access is enforced by Firebase Authentication and Firestore Security Rules. Passwords and private grading material are never stored in the public repository.

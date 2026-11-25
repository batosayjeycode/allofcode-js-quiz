# PLAN.md — JavaScript Interview Challenge Platform

## 1. Project Overview

Build a lightweight, interactive web application for testing JavaScript knowledge and problem-solving skills during developer interviews.

The application presents JavaScript questions with code snippets and predefined answer options. Candidates must analyze the code, predict the execution result, select their answer, and then run the code to verify their understanding.

The system compares the candidate's selected answer with the actual JavaScript execution result, determines whether the answer is correct, and provides a detailed explanation.

The application should support an expandable question bank, allowing new questions to be added without modifying the core application logic.

## 2. Objectives

- Evaluate JavaScript fundamentals and logical reasoning.
- Test candidates' ability to predict code execution results.
- Provide an interactive answer-and-run experience.
- Display the actual execution result and compare it with the candidate's answer.
- Explain why the answer is correct or incorrect.
- Support an initial set of 10 questions and allow additional questions to be added easily.
- Keep the application lightweight, responsive, and easy to use during interviews.

## 3. Core User Flow

1. The candidate opens the interview challenge.
2. The system displays a JavaScript question and its code snippet.
3. The candidate analyzes the code and selects their predicted answer.
4. The candidate submits or locks their answer.
5. The **Run Code** button becomes available.
6. The system executes the JavaScript code.
7. The execution result is displayed.
8. The system compares the candidate's answer with the actual result.
9. The system displays:
   - Correct or incorrect status.
   - Actual execution result.
   - Explanation of the execution behavior.
10. The candidate proceeds to the next question.
11. After completing all questions, the system displays the final score and summary.

## 4. Question Types

Each question should have a predefined answer type.

### A. TRUE

The code executes successfully and produces the expected result.

### B. FALSE

The code executes successfully, but the candidate's selected answer or expected behavior is incorrect.

### C. ERROR

The code throws an exception or fails during execution.

The system must distinguish between a valid execution result and a runtime error.

> Answer options should represent expected execution behavior, not simply generic True/False statements.

For example, candidates may need to identify whether the output is `true`, `false`, or whether the code throws an error.

## 5. Question Interface

Each question should contain:

- Question number
- Question title
- Difficulty level
- Question description
- JavaScript code snippet
- Answer options
- Answer selection control
- Run Code button
- Execution result section
- Correct/incorrect indicator
- Explanation section
- Next Question button

### Example Question

**Question 1 — JavaScript Variable Scope**

Difficulty: Intermediate

What will happen when this code executes?

```javascript
console.log(a);

var a = 10;
```

**Answer options:**

- A. `10`
- B. `undefined`
- C. `ReferenceError`
- D. `SyntaxError`

**Expected result:**

```text
undefined
```

**Explanation:**

Variables declared using `var` are hoisted. The declaration is processed before execution, but the assignment remains at its original position. Therefore, accessing `a` before its assignment returns `undefined` instead of throwing a `ReferenceError`.

## 6. Code Execution & Validation

The application must execute JavaScript code when the candidate clicks the **Run Code** button.

### Execution requirements

- Execute code in an isolated environment.
- Capture the execution output.
- Capture runtime errors.
- Handle execution timeouts.
- Prevent infinite loops from freezing the application.
- Display the execution result in a readable format.
- Normalize the result before comparing it with the expected answer when necessary.

### Result handling

| Execution outcome | Display |
|---|---|
| Boolean result | `true` / `false` |
| String | String value |
| Number | Numeric value |
| Undefined | `undefined` |
| Null | `null` |
| Array/Object | Readable representation |
| Runtime exception | Error name and message |
| Timeout | Execution timeout |

Do not rely only on `eval()` running directly in the main application context. Use a sandboxed execution mechanism with appropriate restrictions.

## 7. Answer Validation Logic

Each question must define its expected execution result or expected execution behavior.

The validation process:

1. Retrieve the candidate's selected answer.
2. Execute the JavaScript code.
3. Capture the execution result.
4. Normalize the actual result.
5. Compare it against the question's expected result.
6. Determine whether the candidate's answer is correct.
7. Display the evaluation and explanation.

### Validation example

```javascript
const question = {
  expectedResult: "undefined",
  candidateAnswer: "undefined",
  actualResult: "undefined"
};

const isCorrect = question.candidateAnswer === question.actualResult;
```

The comparison logic should support different result types and must not depend solely on string comparison for complex values.

## 8. Question Bank Structure

Questions must be stored separately from the application logic.

Use a structured format such as JSON or JavaScript modules to make questions easy to maintain and extend.

### Example

```javascript
{
  id: "JS-001",
  title: "Variable Hoisting",
  category: "JavaScript Fundamentals",
  difficulty: "Intermediate",
  description: "Predict the execution result.",
  code: `
    console.log(a);
    var a = 10;
  `,
  options: [
    "10",
    "undefined",
    "ReferenceError",
    "SyntaxError"
  ],
  expectedResult: "undefined",
  resultType: "output",
  explanation: "The var declaration is hoisted, but its assignment is not.",
  points: 1
}
```

### Question bank requirements

- Start with 10 questions.
- Support adding unlimited questions.
- Each question must have a unique ID.
- Support categories and difficulty levels.
- Support different answer types.
- Keep questions independent from the UI.
- Avoid hardcoding questions inside components.

## 9. Initial Question Categories

The initial question bank should cover a variety of JavaScript concepts.

| Category | Topics |
|---|---|
| JavaScript Fundamentals | Variables, data types, type coercion |
| Scope & Hoisting | `var`, `let`, `const`, closures |
| Functions | Execution context, return values |
| Array & Object | Reference behavior, mutations |
| Async JavaScript | Promises, async/await |
| Event Loop | Microtasks, macrotasks |
| Operators | Equality, logical operators |
| Error Handling | ReferenceError, TypeError, SyntaxError |

The first 10 questions should have varying difficulty levels, ideally from basic to advanced.

## 10. Scoring System

- Each question has a configurable point value.
- Correct answers earn the assigned points.
- Incorrect answers earn zero points.
- Runtime errors can be valid answers if the question expects an error.
- The final score is calculated based on the total earned points.

### Final Summary

Display:

- Total questions
- Correct answers
- Incorrect answers
- Total score
- Score percentage
- Performance summary

Example:

```text
Interview Result

Total Questions : 10
Correct Answers : 7
Incorrect       : 3
Score          : 70%

Performance     : Good
```

## 11. UI/UX Requirements

Create a clean, modern, developer-focused interface.

### Layout

- Header with application title and progress.
- Question navigation or progress indicator.
- Main question card.
- Code block with syntax highlighting.
- Answer options displayed clearly.
- Run Code button.
- Execution result panel.
- Explanation panel.
- Next/Previous question navigation.

### Design principles

- Minimalist developer-tool aesthetic.
- Readable typography.
- Comfortable spacing.
- Syntax-highlighted JavaScript code.
- Clear visual distinction between correct, incorrect, and error states.
- Responsive layout for desktop and tablet.
- Avoid unnecessary animations or distracting elements.

### Result indicators

- Correct answer: success indicator.
- Incorrect answer: warning/error indicator.
- Runtime exception: error output panel.
- Timeout: execution timeout indicator.

## 12. Application Behavior

- Candidates must select an answer before running the code.
- The selected answer should be locked once the code is executed to prevent changing answers after seeing the result.
- The candidate must run the code to see the actual result.
- The explanation should only be revealed after execution.
- Candidates can navigate between questions.
- Completed questions should have a visible status.
- The application should track candidate answers and execution results during the session.
- The candidate should be able to review completed questions.
- Final results should only be calculated from completed questions.

## 13. Extensibility

The system should be designed to support future improvements:

- Add more questions without changing the core engine.
- Add new question categories.
- Add difficulty filtering.
- Randomize question order.
- Randomize answer options.
- Support multiple interview sets.
- Support custom interview configurations.
- Add timer mode.
- Add interview session tracking.
- Export interview results.
- Support additional JavaScript execution scenarios.

These features are future enhancements and should not unnecessarily increase the complexity of the initial implementation.

## 14. Technical Constraints

- Keep the application lightweight.
- Prefer vanilla JavaScript or the existing project stack if one is already available.
- Avoid unnecessary dependencies.
- Separate question data, execution logic, validation logic, and UI rendering.
- Use a safe execution strategy for running candidate code.
- Ensure the application works without a backend for the initial version, unless backend functionality is required for secure execution.
- Do not introduce databases or authentication in the MVP.

## 15. MVP Scope

The first version should include:

- 10 JavaScript questions.
- Multiple-choice answers.
- Code execution.
- Execution output display.
- Runtime error detection.
- Answer validation.
- Correct/incorrect feedback.
- Explanation for each question.
- Progress tracking.
- Final score summary.
- Extendable question bank.

## 16. Implementation Guidelines

Before implementation:

1. Inspect the existing project structure and framework.
2. Reuse the existing stack and conventions if available.
3. Identify the safest available code execution approach.
4. Define the question schema.
5. Implement the question bank.
6. Implement the execution engine.
7. Implement answer validation.
8. Build the UI.
9. Test all initial questions against their expected results.
10. Test edge cases such as runtime errors, undefined values, and execution timeouts.

Do not unnecessarily refactor unrelated components or modify unrelated functionality.

## 17. Acceptance Criteria

The application is considered complete when:

- [ ] The application displays 10 JavaScript questions.
- [ ] Candidates can select an answer before running the code.
- [ ] The Run Code button executes the question's JavaScript code.
- [ ] The execution result is displayed correctly.
- [ ] Runtime errors are captured and displayed.
- [ ] Infinite loops or excessive execution are safely terminated.
- [ ] Candidate answers are evaluated correctly.
- [ ] Correct/incorrect feedback is displayed.
- [ ] An explanation is displayed after execution.
- [ ] Candidates can navigate between questions.
- [ ] Progress is tracked.
- [ ] The final score is calculated correctly.
- [ ] Questions can be added without changing the core application logic.
- [ ] The application is responsive and usable on desktop and tablet.

## 18. Deliverable

Build a complete, functional JavaScript interview challenge web application with an initial set of 10 well-designed questions.

The questions should focus on evaluating real JavaScript understanding rather than memorizing syntax. Include code snippets that test execution behavior, scope, data types, asynchronous execution, logical reasoning, and common JavaScript pitfalls.

Prioritize correctness, clarity, maintainability, and a smooth interview experience.

## Recommended Initial Question Distribution

For Senior JavaScript interviews, avoid making all questions too basic. A balanced initial set:

- 2 questions — Fundamental & Type Coercion
- 2 questions — Scope, Hoisting & Closure
- 2 questions — Promise & Async/Await
- 2 questions — Event Loop
- 2 questions — Tricky JavaScript / Error Handling

Avoid using only `true`, `false`, or `error` as answer options. Include actual outputs such as `undefined`, `NaN`, `ReferenceError`, execution order, and other JavaScript behaviors to better evaluate candidates' understanding.

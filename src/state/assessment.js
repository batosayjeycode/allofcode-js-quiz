/**
 * Interviewer summary, built only from the quiz data with fixed rules (no AI,
 * no randomness). Topics and questions are sorted by name/id, so the same
 * answers always produce the same summary regardless of the session's order.
 */
import { assessmentConfig } from '../assessment.config.js';
import { DIFFICULTIES } from '../questions/schema.js';

/** "45s", "3m 05s" */
export function formatDuration(ms) {
  const total = Math.round(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

const statusOf = (answer) => {
  if (answer?.status !== 'done' || !answer.evaluation) return 'unanswered';
  return answer.evaluation.isCorrect ? 'correct' : 'incorrect';
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const byName = (a, b) => a.localeCompare(b, 'en');
const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });

/** Time from the start of the quiz to its end (or to `now` while it runs). */
export function timeSpentMs(state, now = state.endedAt) {
  if (!state.quizStartedAt) return 0;
  return Math.max(0, (state.endedAt ?? now) - state.quizStartedAt);
}

/**
 * @param {Array} questions  the question bank (any order)
 * @param {object} state     session state (answers, endReason, tabSwitches…)
 * @param {ReturnType<import('./scoring.js').computeSummary>} summary
 * @param {{ followUpPrompts?: Record<string, string> }} [options]
 */
export function buildInterviewerSummary(questions, state, summary, { followUpPrompts = assessmentConfig.followUpPrompts } = {}) {
  // Per-topic tallies.
  const topics = new Map();
  for (const question of [...questions].sort(byId)) {
    const status = statusOf(state.answers[question.id]);
    const topic = topics.get(question.category) ?? { category: question.category, total: 0, correct: 0, incorrect: 0, unanswered: 0, questions: [] };
    topic.total += 1;
    topic[status] += 1;
    topic.questions.push({ id: question.id, title: question.title, difficulty: question.difficulty, status });
    topics.set(question.category, topic);
  }
  const allTopics = [...topics.values()].sort((a, b) => byName(a.category, b.category));

  // Strength: every question in the topic answered correctly.
  const strengths = allTopics.filter((t) => t.correct === t.total);
  // Improvement: anything missed or skipped. Most incorrect first, then most unanswered.
  const improvements = allTopics
    .filter((t) => t.incorrect + t.unanswered > 0)
    .sort((a, b) => b.incorrect - a.incorrect || b.unanswered - a.unanswered || byName(a.category, b.category));

  const byDifficulty = DIFFICULTIES.filter((d) => summary.byDifficulty[d]).map((difficulty) => ({
    difficulty,
    ...summary.byDifficulty[difficulty],
  }));

  const followUps = improvements.map((topic) => ({
    topic: topic.category,
    prompt: followUpPrompts[topic.category] ?? `Ask the candidate to explain the core rules behind ${topic.category}.`,
    questions: topic.questions.filter((q) => q.status !== 'correct'),
  }));
  if (!followUps.length) {
    const hardest = [...questions].filter((q) => q.difficulty === 'Hard').sort(byId);
    followUps.push({
      topic: 'Depth check',
      prompt: 'Every question was answered correctly. Ask the candidate to talk through their reasoning on the hardest questions to confirm depth.',
      questions: hardest.map((q) => ({ id: q.id, title: q.title, difficulty: q.difficulty, status: 'correct' })),
    });
  }

  const completedQuiz = state.endReason === 'completed';
  const spent = timeSpentMs(state);
  const notes = [
    completedQuiz
      ? `Completed all questions in ${formatDuration(spent)} of the ${state.durationMinutes}-minute limit.`
      : `Time expired after ${state.durationMinutes} minutes with ${plural(summary.unanswered, 'question')} unanswered.`,
  ];
  if (state.tabSwitches > 0) {
    notes.push(`Left the quiz tab ${plural(state.tabSwitches, 'time')} (${formatDuration(state.hiddenMs)} away). Worth asking about.`);
  }
  const hard = summary.byDifficulty.Hard;
  if (hard && hard.correct + hard.incorrect > 0 && hard.accuracy >= 75) {
    notes.push(`Strong on Hard questions: ${hard.correct} of ${hard.correct + hard.incorrect} answered correctly.`);
  }
  const easy = summary.byDifficulty.Easy;
  if (easy && easy.incorrect > 0) {
    notes.push(`Missed ${plural(easy.incorrect, 'Easy question')}: check the fundamentals.`);
  }

  return {
    overall: {
      label: summary.performance.label,
      tone: summary.performance.tone,
      headline: summary.completed
        ? `${summary.earnedPoints} of ${summary.totalPoints} points (${summary.percentage}%). ${summary.correct} of ${summary.completed} answered questions correct (${summary.accuracy}% accuracy); ${summary.completed} of ${summary.totalQuestions} questions answered.`
        : `No questions answered: 0 of ${summary.totalPoints} points.`,
    },
    strengths,
    improvements,
    byDifficulty,
    followUps,
    notes,
  };
}

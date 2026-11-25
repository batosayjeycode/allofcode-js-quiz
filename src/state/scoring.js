/**
 * Scoring and final summary. Only completed (executed) questions count as
 * correct/incorrect; unanswered questions earn zero and are reported separately.
 */

export const PERFORMANCE_BANDS = [
  { min: 90, label: 'Excellent', tone: 'success' },
  { min: 70, label: 'Good', tone: 'success' },
  { min: 50, label: 'Fair', tone: 'warning' },
  { min: 0, label: 'Needs Improvement', tone: 'danger' },
];

export function performanceFor(percentage) {
  return PERFORMANCE_BANDS.find((band) => percentage >= band.min) ?? PERFORMANCE_BANDS.at(-1);
}

/**
 * @param {Array<{ id: string, points: number }>} questions
 * @param {Record<string, { status: string, evaluation?: { isCorrect: boolean, pointsEarned: number } }>} answers
 */
export function computeSummary(questions, answers) {
  let completed = 0;
  let correct = 0;
  let earnedPoints = 0;
  let totalPoints = 0;

  for (const question of questions) {
    totalPoints += question.points;
    const answer = answers[question.id];
    if (answer?.status !== 'done' || !answer.evaluation) continue;
    completed += 1;
    if (answer.evaluation.isCorrect) {
      correct += 1;
      earnedPoints += answer.evaluation.pointsEarned;
    }
  }

  const percentage = totalPoints ? Math.round((earnedPoints / totalPoints) * 1000) / 10 : 0;

  return {
    totalQuestions: questions.length,
    completed,
    correct,
    incorrect: completed - correct,
    unanswered: questions.length - completed,
    earnedPoints,
    totalPoints,
    percentage,
    performance: performanceFor(percentage),
  };
}
